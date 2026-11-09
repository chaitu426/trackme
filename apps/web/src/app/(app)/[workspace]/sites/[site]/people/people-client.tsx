"use client";

import { PageHeader } from "@/components/ui/page-header";
import * as React from "react";
import { AnimatePresence } from "motion/react";
import { SidePanelFrame } from "@/components/ui/dialog";
import {
  Search,
  Code,
  X,
  Loader2,
  ChevronRight,
  Check,
  Copy,
  MapPin,
  Monitor,
  Zap,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { MatrixArt } from "@/components/ui/matrix-art";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionReplay } from "@/components/session-replay";
import { UserTimeline } from "@/components/user-timeline";
import { SegmentBuilder, type SavedSegment } from "./segment-builder";
import { describeBehavior, describeCondition } from "@/lib/segment-schema";
import { formatRelativeTime } from "@/lib/format";
import type { UserTimelineEvent } from "@trackme/analytics";

export interface UserProfileItem {
  id: string;
  distinctId: string;
  anonymousId: string | null;
  name: string | null;
  email: string | null;
  traits: Record<string, unknown>;
  totalSessions: number;
  totalEvents: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface PeopleClientProps {
  site: { id: string; domain: string };
  initialProfiles: UserProfileItem[];
  /** A search the page was opened with; the list is already filtered to it. */
  initialSearch?: string;
  workspaceSlug: string;
  stats: { total: number; active7d: number; avgEvents: number };
}

const IDENTIFY_SNIPPET = `// In your frontend code once the user logs in:
window.trackme.identify("user_123", {
  name: "Alex Smith",
  email: "alex@company.com",
  plan: "pro"
});`;

function displayNameOf(user: Pick<UserProfileItem, "name" | "email" | "distinctId">): string {
  return user.name || user.email || user.distinctId;
}

function initialsOf(label: string): string {
  const parts = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : label.slice(0, 2);
  return letters.toUpperCase();
}

/** Green when seen in the last 5 minutes, blue within a day, grey otherwise. */
function activityOf(lastSeenAt: string): { label: string; dot: string } {
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (age < 5 * 60_000) return { label: "Active now", dot: "bg-[#4cc38a]" };
  if (age < 24 * 3_600_000) return { label: "Active today", dot: "bg-zinc-300" };
  return { label: "Inactive", dot: "bg-zinc-600" };
}

function Avatar({ label, size = "md" }: { label: string; size?: "md" | "lg" }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.05] font-medium text-zinc-200 ${
        size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"
      }`}
    >
      {initialsOf(label)}
    </div>
  );
}

export function PeopleClient({ site, workspaceSlug, initialProfiles, initialSearch = "", stats }: PeopleClientProps) {
  const [profiles, setProfiles] = React.useState<UserProfileItem[]>(initialProfiles);
  const [search, setSearch] = React.useState(initialSearch);
  const [isSearching, setIsSearching] = React.useState(false);
  const PAGE_SIZE = 50;
  const [hasMore, setHasMore] = React.useState(initialProfiles.length >= PAGE_SIZE && stats.total > initialProfiles.length);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<UserProfileItem | null>(null);
  const [timeline, setTimeline] = React.useState<UserTimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = React.useState(false);
  const [timelineError, setTimelineError] = React.useState(false);
  const [copiedSnippet, setCopiedSnippet] = React.useState(false);

  // Search: debounced, and each new term aborts the request still in flight so a slow
  // answer for "al" can never overwrite the results for "alex".
  const searchAbort = React.useRef<AbortController | null>(null);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchAbort.current?.abort();
    },
    []
  );

  function handleSearch(term: string) {
    if (activeSegment) {
      segmentAbort.current?.abort();
      setActiveSegment(null);
      setSegmentCount(null);
      setSegmentLoading(false);
    }
    setSearch(term);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void runSearch(term), 250);
  }

  async function runSearch(term: string) {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/people?query=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setHasMore(Boolean(data.hasMore));
        setProfiles(
          data.profiles.map((p: UserProfileItem) => ({
            ...p,
            firstSeenAt: typeof p.firstSeenAt === "string" ? p.firstSeenAt : new Date(p.firstSeenAt).toISOString(),
            lastSeenAt: typeof p.lastSeenAt === "string" ? p.lastSeenAt : new Date(p.lastSeenAt).toISOString(),
          }))
        );
      }
    } catch {
      // aborted by a newer search, or offline: keep what is on screen
    } finally {
      if (searchAbort.current === controller) setIsSearching(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/sites/${site.id}/people?query=${encodeURIComponent(search.trim())}&limit=${PAGE_SIZE}&offset=${profiles.length}`
      );
      if (res.ok) {
        const data = await res.json();
        const more: UserProfileItem[] = data.profiles.map((p: UserProfileItem) => ({
          ...p,
          firstSeenAt: typeof p.firstSeenAt === "string" ? p.firstSeenAt : new Date(p.firstSeenAt).toISOString(),
          lastSeenAt: typeof p.lastSeenAt === "string" ? p.lastSeenAt : new Date(p.lastSeenAt).toISOString(),
        }));
        setProfiles((cur) => {
          const seen = new Set(cur.map((p) => p.id));
          return [...cur, ...more.filter((p) => !seen.has(p.id))];
        });
        setHasMore(Boolean(data.hasMore));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  // Saved segments
  const everyone = React.useRef(initialProfiles);
  const [segments, setSegments] = React.useState<SavedSegment[]>([]);
  const [segmentsStatus, setSegmentsStatus] = React.useState<"loading" | "ready" | "unavailable">("loading");
  const [activeSegment, setActiveSegment] = React.useState<SavedSegment | null>(null);
  const [segmentCount, setSegmentCount] = React.useState<{ total: number; capped: boolean } | null>(null);
  const [segmentLoading, setSegmentLoading] = React.useState(false);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const segmentAbort = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sites/${site.id}/segments`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setSegmentsStatus("unavailable");
          return;
        }
        const body = await res.json();
        setSegments(body.segments ?? []);
        setSegmentsStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setSegmentsStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [site.id]);

  const traitKeys = React.useMemo(
    () => [...new Set(everyone.current.flatMap((u) => Object.keys(u.traits || {})))].sort(),
    []
  );

  async function selectSegment(segment: SavedSegment | null) {
    segmentAbort.current?.abort();
    setConfirmDelete(false);
    setSearch("");
    setActiveSegment(segment);
    if (!segment) {
      if (initialSearch) {
        // Opened already searched for one person: "Everyone" must fetch the full list, not reuse the filtered one.
        setSegmentCount(null);
        setSegmentLoading(false);
        void runSearch("");
        return;
      }
      setProfiles(everyone.current);
      setHasMore(everyone.current.length >= PAGE_SIZE && stats.total > everyone.current.length);
      setSegmentCount(null);
      setSegmentLoading(false);
      return;
    }
    const controller = new AbortController();
    segmentAbort.current = controller;
    setSegmentLoading(true);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/segments/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ definition: segment.definition }),
      });
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles);
        setSegmentCount({ total: data.total, capped: data.capped });
      }
    } catch {
      // aborted by another selection, or offline: keep what is on screen
    } finally {
      if (segmentAbort.current === controller) setSegmentLoading(false);
    }
  }

  async function deleteSegment(segment: SavedSegment) {
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/segments/${segment.id}`, { method: "DELETE" });
      if (res.ok) {
        setSegments((prev) => prev.filter((s) => s.id !== segment.id));
        void selectSegment(null);
      }
    } catch {
      // leave it in place; the user can try again
    }
  }

  // Reached through a link to one person (an error's affected users, a copied link): open their profile directly.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (autoOpened.current || !initialSearch || initialProfiles.length !== 1) return;
    autoOpened.current = true;
    void openUserDrawer(initialProfiles[0]!);
    // Runs once on arrival.
  }, []);

  // Timelines already opened this session, so reopening a profile is instant.
  const timelineCache = React.useRef(new Map<string, UserTimelineEvent[]>());

  async function openUserDrawer(user: UserProfileItem) {
    setSelectedUser(user);
    setTimelineError(false);
    const cachedTimeline = timelineCache.current.get(user.distinctId);
    if (cachedTimeline) {
      setTimeline(cachedTimeline);
      setLoadingTimeline(false);
      return;
    }
    setLoadingTimeline(true);
    setTimeline([]);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/people/${encodeURIComponent(user.distinctId)}`);
      if (res.ok) {
        const data = await res.json();
        const events: UserTimelineEvent[] = data.timeline || [];
        timelineCache.current.set(user.distinctId, events);
        setTimeline(events);
      } else {
        setTimelineError(true);
      }
    } catch {
      setTimelineError(true);
    } finally {
      setLoadingTimeline(false);
    }
  }

  function copyIdentifySnippet() {
    void navigator.clipboard.writeText(IDENTIFY_SNIPPET);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }

  const searching = search.trim().length > 0;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="User Profiles" art="stream" actions={<button
          type="button"
          onClick={copyIdentifySnippet}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/[0.1] bg-[#232325]/80 px-3 font-mono text-xs text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-white/[0.2]"
          title="Copy the identify() snippet"
        >
          {copiedSnippet ? <Check className="h-4 w-4 text-[#4cc38a]" /> : <Code className="h-4 w-4 text-zinc-400" />}
          {copiedSnippet ? "Copied" : "trackme.identify()"}
        </button>}>
        Who your customers are, and the path each one took through <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatsCard title="Identified users" value={stats.total.toLocaleString()} subtitle="Unique people with a distinct ID" />
        <StatsCard
          title="Active, last 7 days"
          value={stats.active7d.toLocaleString()}
          subtitle={
            stats.total > 0
              ? `${Math.round((stats.active7d / stats.total) * 100)}% of identified users`
              : "Users seen in the past week"
          }
        />
        <StatsCard
          title="Avg events per user"
          value={stats.total > 0 ? stats.avgEvents.toLocaleString() : "–"}
          subtitle="Lifetime average across all identified users"
        />
      </div>

      {/* Segments */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Segments"
            className="flex h-8 max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-white/[0.08] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!activeSegment}
              onClick={() => void selectSegment(null)}
              className={`inline-flex h-full shrink-0 items-center rounded-md px-3 text-xs transition-colors ${
                !activeSegment ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Everyone
            </button>
            {segments.map((segment) => (
              <button
                key={segment.id}
                type="button"
                role="tab"
                aria-selected={activeSegment?.id === segment.id}
                onClick={() => void selectSegment(segment)}
                className={`inline-flex h-full shrink-0 items-center rounded-md px-3 text-xs transition-colors ${
                  activeSegment?.id === segment.id
                    ? "bg-raised font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {segment.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            disabled={segmentsStatus === "unavailable"}
            title={segmentsStatus === "unavailable" ? "Saved segments are unavailable right now" : undefined}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            New segment
          </button>
        </div>

        {segmentsStatus === "unavailable" && (
          <p className="text-xs text-zinc-600">
            Saved segments are unavailable right now. Everything else on this page still works; try again shortly or contact your administrator.
          </p>
        )}

        {activeSegment && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {activeSegment.definition.conditions.map((c, i) => (
                <span key={i} className="rounded border border-white/[0.07] bg-white/[0.03] px-2 py-px text-[10.5px] text-zinc-300">
                  {describeCondition(c)}
                </span>
              ))}
              {activeSegment.definition.behavior.map((b, i) => (
                <span key={`b${i}`} className="rounded border border-white/[0.14] bg-white/[0.07] px-2 py-px text-[10.5px] text-zinc-100">
                  {describeBehavior(b)}
                </span>
              ))}
              {activeSegment.definition.conditions.length > 1 && (
                <span className="text-xs text-zinc-600">match {activeSegment.definition.match}</span>
              )}
            </div>
            {confirmDelete ? (
              <span className="flex items-center gap-1 rounded-md border border-[#e5484d]/25 bg-[#e5484d]/10 pl-2 text-xs text-[#e5484d]">
                Delete segment?
                <button type="button" onClick={() => void deleteSegment(activeSegment)} className="px-2 py-1 font-medium hover:text-white">
                  Yes
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-zinc-400 hover:text-zinc-100">
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete segment"
                title="Delete segment"
                className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-[#e5484d]/10 hover:text-[#e5484d]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Directory */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="gap-3 border-b border-white/[0.08] p-5 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>People</CardTitle>
            <CardDescription>
              {activeSegment
                ? segmentLoading
                  ? "Finding matching people…"
                  : `${(segmentCount?.total ?? profiles.length).toLocaleString()}${segmentCount?.capped ? "+" : ""} in “${activeSegment.name}”${
                      segmentCount && segmentCount.total > profiles.length ? `, showing the ${profiles.length} most recently active` : ""
                    }`
                : searching
                ? `${profiles.length} ${profiles.length === 1 ? "match" : "matches"} for “${search.trim()}”`
                : `${profiles.length.toLocaleString()} most recently active`}
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              aria-label="Search people"
              placeholder="Search email, name or ID"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-white/[0.1] bg-sidebar pl-9 pr-8 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-white/[0.3]"
            />
            {isSearching ? (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-zinc-400" />
            ) : (
              searching && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => handleSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )
            )}
          </div>
        </CardHeader>

        {profiles.length === 0 ? (
          <EmptyState searching={searching} onCopy={copyIdentifySnippet} copied={copiedSnippet} />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {profiles.map((user) => {
              const label = displayNameOf(user);
              const activity = activityOf(user.lastSeenAt);
              const traits = Object.entries(user.traits || {});
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => void openUserDrawer(user)}
                    className="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline-none"
                  >
                    <div className="relative">
                      <Avatar label={label} />
                      <span
                        title={activity.label}
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${activity.dot}`}
                      />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-[13px] font-medium text-zinc-100">{label}</span>
                        {user.name && user.email && <span className="truncate text-xs text-zinc-500">{user.email}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-white/[0.06] bg-white/[0.025] px-2 py-px font-mono text-xs text-zinc-500">
                          {user.distinctId}
                        </span>
                        {traits.slice(0, 3).map(([k, v]) => (
                          <span
                            key={k}
                            className="rounded border border-white/[0.06] bg-white/[0.025] px-2 py-px text-xs text-zinc-400"
                          >
                            <span className="text-zinc-500">{k}</span> {String(v)}
                          </span>
                        ))}
                        {traits.length > 3 && <span className="text-xs text-zinc-600">+{traits.length - 3}</span>}
                      </div>
                    </div>

                    <div className="hidden w-24 shrink-0 text-right sm:block">
                      <p className="text-xs font-medium tabular-nums text-zinc-200">{user.totalSessions.toLocaleString()}</p>
                      <p className="text-xs text-zinc-500">sessions</p>
                    </div>
                    <div className="hidden w-24 shrink-0 text-right md:block">
                      <p className="text-xs font-medium tabular-nums text-zinc-200">{user.totalEvents.toLocaleString()}</p>
                      <p className="text-xs text-zinc-500">events</p>
                    </div>
                    <div className="hidden w-24 shrink-0 text-right md:block">
                      <p className="text-xs text-zinc-300" suppressHydrationWarning>
                        {formatRelativeTime(user.lastSeenAt)}
                      </p>
                      <p className="text-xs text-zinc-500">last active</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700 transition-colors group-hover:translate-x-0.5 group-hover:text-zinc-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && !activeSegment && profiles.length > 0 && (
          <div className="flex justify-center border-t border-white/[0.05] pt-3">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="inline-flex h-8 items-center rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more people"}
            </button>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {builderOpen && (
          <SegmentBuilder
            siteId={site.id}
            traitKeys={traitKeys}
            onClose={() => setBuilderOpen(false)}
            onSaved={(segment) => {
              setSegments((prev) => [segment, ...prev]);
              setBuilderOpen(false);
              void selectSegment(segment);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
      {selectedUser && (
        <ProfileDrawer
          user={selectedUser}
          site={{ id: site.id, domain: site.domain, workspaceSlug }}
          timeline={timeline}
          loading={loadingTimeline}
          error={timelineError}
          onRetry={() => {
            timelineCache.current.delete(selectedUser.distinctId);
            void openUserDrawer(selectedUser);
          }}
          onClose={() => setSelectedUser(null)}
        />
      )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ searching, onCopy, copied }: { searching: boolean; onCopy: () => void; copied: boolean }) {
  if (searching) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm font-medium text-zinc-300">No one matches that search</p>
        <p className="mt-1 text-xs text-zinc-500">Try an email address, a name, or the exact distinct ID.</p>
      </div>
    );
  }
  return (
    <div className="px-6 py-12">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <MatrixArt variant="stream" className="h-28" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-zinc-200">No identified users yet</h3>
          <p className="text-xs leading-relaxed text-zinc-400">
            Visitors stay anonymous until you call <code className="font-mono text-zinc-200">identify()</code>. Do it after
            login and each person gets a profile, traits and a full journey.
          </p>
        </div>
        <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 text-left">
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">{IDENTIFY_SNIPPET}</pre>
          <button
            type="button"
            onClick={onCopy}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-300 hover:text-white"
          >
            {copied ? <Check className="h-4 w-4 text-[#4cc38a]" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Profile drawer ───────────────────────────── */

interface SessionGroup {
  id: string;
  events: UserTimelineEvent[]; // oldest first
  start: Date;
  end: Date;
}

function groupBySession(timeline: UserTimelineEvent[]): SessionGroup[] {
  const groups = new Map<string, UserTimelineEvent[]>();
  for (const event of timeline) {
    const key = event.sessionId || `solo-${event.eventId}`;
    const list = groups.get(key);
    if (list) list.push(event);
    else groups.set(key, [event]);
  }
  return [...groups.entries()]
    .map(([id, events]) => {
      const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return {
        id,
        events: sorted,
        start: new Date(sorted[0]!.timestamp),
        end: new Date(sorted[sorted.length - 1]!.timestamp),
      };
    })
    .sort((a, b) => b.start.getTime() - a.start.getTime());
}

function formatSpan(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return "under a second";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const dateTime = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" });

function isGoalEvent(event: UserTimelineEvent): boolean {
  return event.properties?.eventName === "goal_completed" || Boolean(event.properties?.goal);
}

function ProfileDrawer({
  user,
  site,
  timeline,
  loading,
  error,
  onRetry,
  onClose,
}: {
  user: UserProfileItem;
  site: { id: string; domain: string; workspaceSlug: string };
  timeline: UserTimelineEvent[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const [copiedId, setCopiedId] = React.useState(false);
  const [view, setView] = React.useState<"timeline" | "sessions">("timeline");
  const label = displayNameOf(user);
  const traits = Object.entries(user.traits || {});
  const sessions = React.useMemo(() => groupBySession(timeline), [timeline]);
  const pageviews = timeline.filter((e) => e.type === "pageview").length;

  return (
    <SidePanelFrame onClose={onClose} label={`Profile for ${label}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar label={label} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium text-zinc-50">{label}</h2>
              {user.email && user.name && <p className="truncate text-xs text-zinc-400">{user.email}</p>}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(user.distinctId);
                  setCopiedId(true);
                  setTimeout(() => setCopiedId(false), 1500);
                }}
                className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-zinc-500 transition-colors hover:text-zinc-200"
                title="Copy distinct ID"
              >
                {user.distinctId}
                {copiedId ? <Check className="h-4 w-4 text-[#4cc38a]" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* Lifetime */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Sessions", user.totalSessions.toLocaleString()],
              ["Events", user.totalEvents.toLocaleString()],
              ["First seen", dateTime.format(new Date(user.firstSeenAt))],
              ["Last seen", dateTime.format(new Date(user.lastSeenAt))],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-xs font-medium text-zinc-500">{k}</p>
                <p className="mt-1 text-[13px] font-medium tabular-nums text-zinc-100">{v}</p>
              </div>
            ))}
          </div>

          {/* Traits */}
          {traits.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-zinc-400">Traits</h3>
              <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-2">
                {traits.map(([key, val]) => (
                  <div key={key} className="flex items-baseline justify-between gap-3 bg-card px-3 py-2">
                    <dt className="font-mono text-xs text-zinc-500">{key}</dt>
                    <dd className="truncate text-xs font-medium text-zinc-200">{String(val)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <div role="tablist" aria-label="Activity view" className="flex w-fit items-center gap-0.5 rounded-lg border border-white/[0.08] p-0.5 text-xs">
            {(["timeline", "sessions"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === id ? "bg-raised text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}
              >
                {id === "timeline" ? "Timeline" : "Sessions & replay"}
              </button>
            ))}
          </div>

          {view === "timeline" && (
            <UserTimeline siteId={site.id} distinctId={user.distinctId} workspaceSlug={site.workspaceSlug} siteDomain={site.domain} />
          )}

          {/* Journey */}
          {view === "sessions" && (
          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <h3 className="text-xs font-medium text-zinc-400">Journey</h3>
              {!loading && timeline.length > 0 && (
                <span className="text-xs text-zinc-500">
                  {sessions.length} {sessions.length === 1 ? "session" : "sessions"} · {pageviews} pageviews · {timeline.length} events
                </span>
              )}
            </div>

            {loading ? (
              <div role="status" aria-busy="true" className="space-y-3">
                <span className="sr-only">Loading journey</span>
                {[0, 1].map((i) => (
                  <div key={i} className="space-y-3 rounded-xl border border-white/[0.07] p-4">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-dashed border-[#e5484d]/30 bg-[#e5484d]/5 p-6 text-center">
                <p className="text-xs text-[#e5484d]">The activity stream could not be loaded.</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 rounded-md border border-white/[0.1] px-3 py-1 text-xs text-zinc-200 hover:bg-white/[0.05]"
                >
                  Retry
                </button>
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-500">
                No events recorded for this person yet.
              </div>
            ) : (
              <ol className="space-y-3">
                {sessions.map((session, i) => (
                  <SessionCard key={session.id} session={session} defaultOpen={i === 0} />
                ))}
              </ol>
            )}
          </section>
          )}
        </div>
    </SidePanelFrame>
  );
}

function SessionCard({ session, defaultOpen }: { session: SessionGroup; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [replaying, setReplaying] = React.useState(false);
  const first = session.events[0]!;
  const pages = session.events.filter((e) => e.type === "pageview");
  // Collapse refreshes: the route is the sequence of distinct consecutive pages.
  const route = pages.map((e) => e.path || e.url).filter((p, i, arr) => i === 0 || p !== arr[i - 1]);
  const actions = session.events.filter((e) => e.type !== "pageview");
  const where = [first.city, first.country?.trim()].filter(Boolean).join(", ");
  const tech = [first.browser, first.os].filter(Boolean).join(" · ");

  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.015]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-100">{dateTime.format(session.start)}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {session.events.length} {session.events.length === 1 ? "event" : "events"} · {formatSpan(session.end.getTime() - session.start.getTime())}
            {actions.length > 0 && ` · ${actions.length} ${actions.length === 1 ? "action" : "actions"}`}
          </p>
        </div>
        <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {/* Route rail: always visible, it is the story of the visit */}
      {route.length > 0 && (
        <div className="flex flex-wrap items-center gap-y-2 px-4 pb-3">
          {route.map((path, i) => (
            <React.Fragment key={`${path}-${i}`}>
              <span
                title={path}
                className={`max-w-[150px] truncate rounded-md border px-2 py-0.5 font-mono text-xs ${
                  i === 0 ? "border-white/[0.14] bg-white/[0.07] text-zinc-100" : "border-white/[0.08] bg-white/[0.025] text-zinc-300"
                }`}
              >
                {path}
              </span>
              {i < route.length - 1 && (
                <span aria-hidden className="mx-1 text-xs text-zinc-600">
                  ›
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
          {session.events.length > 1 &&
            (replaying ? (
              <SessionReplay events={session.events} />
            ) : (
              <button
                type="button"
                onClick={() => setReplaying(true)}
                className="inline-flex items-center gap-2 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-white/[0.18] hover:text-white"
              >
                <Play className="h-4 w-4" />
                Replay this session
              </button>
            ))}
          {(where || tech) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              {where && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> {where}
                </span>
              )}
              {tech && (
                <span className="inline-flex items-center gap-1">
                  <Monitor className="h-4 w-4" /> {tech}
                </span>
              )}
            </p>
          )}
          <ol className="relative space-y-3 pl-4 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-white/10">
            {session.events.map((event) => {
              const goal = isGoalEvent(event);
              const action = event.type !== "pageview";
              return (
                <li key={event.eventId} className="relative">
                  <span
                    className={`absolute -left-[17px] top-1.5 h-[7px] w-[7px] rounded-full ring-2 ring-[#19191b] ${
                      goal ? "bg-white/[0.06]" : action ? "bg-[#4cc38a]" : "bg-zinc-500"
                    }`}
                  />
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 text-xs">
                      {action && (
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-px text-xs font-medium ${
                            goal ? "bg-white/[0.06] text-zinc-300" : "bg-[#4cc38a]/10 text-[#4cc38a]"
                          }`}
                        >
                          {goal && <Zap className="h-4 w-4" />}
                          {goal ? "Goal" : event.type}
                        </span>
                      )}
                      <span className="truncate font-mono text-xs text-zinc-300">
                        {action && event.eventName && event.eventName !== event.type ? event.eventName : event.path || event.url}
                      </span>
                    </p>
                    <time className="shrink-0 font-mono text-xs tabular-nums text-zinc-600" dateTime={event.timestamp}>
                      {timeOnly.format(new Date(event.timestamp))}
                    </time>
                  </div>
                  {event.title && <p className="mt-0.5 truncate text-xs text-zinc-600">{event.title}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </li>
  );
}
