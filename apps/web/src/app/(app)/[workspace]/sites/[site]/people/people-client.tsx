"use client";

import * as React from "react";
import {
  Users,
  Search,
  Activity,
  Code,
  X,
  Loader2,
  Tag,
  ChevronRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  stats: { total: number; active7d: number };
}

export function PeopleClient({ site, initialProfiles, stats }: PeopleClientProps) {
  const [profiles, setProfiles] = React.useState<UserProfileItem[]>(initialProfiles);
  const [search, setSearch] = React.useState("");
  const [isSearching, setIsSearching] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<UserProfileItem | null>(null);
  const [timeline, setTimeline] = React.useState<UserTimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = React.useState(false);
  const [copiedSnippet, setCopiedSnippet] = React.useState(false);

  // Search filter
  async function handleSearch(term: string) {
    setSearch(term);
    setIsSearching(true);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/people?query=${encodeURIComponent(term)}`);
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles.map((p: any) => ({
          ...p,
          firstSeenAt: typeof p.firstSeenAt === "string" ? p.firstSeenAt : new Date(p.firstSeenAt).toISOString(),
          lastSeenAt: typeof p.lastSeenAt === "string" ? p.lastSeenAt : new Date(p.lastSeenAt).toISOString(),
        })));
      }
    } catch {
      // ignore
    } finally {
      setIsSearching(false);
    }
  }

  // Load timeline for selected user
  async function openUserDrawer(user: UserProfileItem) {
    setSelectedUser(user);
    setLoadingTimeline(true);
    setTimeline([]);
    try {
      const res = await fetch(`/api/v1/sites/${site.id}/people/${encodeURIComponent(user.distinctId)}`);
      if (res.ok) {
        const data = await res.json();
        setTimeline(data.timeline || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingTimeline(false);
    }
  }

  function copyIdentifySnippet() {
    navigator.clipboard.writeText(`// In your frontend code once user logs in:\nwindow.trackme.identify("user_123", {\n  name: "Alex Smith",\n  email: "alex@company.com",\n  plan: "pro"\n});`);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
              <Users className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">User Profiles & Journeys</h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Track identified users, inspect customer traits, and watch chronological activity streams.
          </p>
        </div>

        {/* Code snippet trigger */}
        <button
          type="button"
          onClick={copyIdentifySnippet}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.03] text-xs font-mono text-zinc-300 hover:bg-white/[0.06] transition shrink-0"
          title="Click to copy trackme.identify() code snippet"
        >
          {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Code className="w-3.5 h-3.5 text-indigo-400" />}
          <span>{copiedSnippet ? "Snippet Copied!" : "trackme.identify()"}</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-zinc-950/80">
          <span className="text-[11px] font-medium text-zinc-400">Total Identified Users</span>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{stats.total.toLocaleString()}</div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Unique users tracked with distinct IDs</span>
        </div>
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-zinc-950/80">
          <span className="text-[11px] font-medium text-zinc-400">Active Past 7 Days</span>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.active7d.toLocaleString()}</div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Users with recent activity</span>
        </div>
        <div className="p-4 rounded-2xl border border-white/[0.08] bg-zinc-950/80">
          <span className="text-[11px] font-medium text-zinc-400">Profile Engagement</span>
          <div className="text-2xl font-bold text-indigo-400 mt-1">
            {stats.total > 0
              ? `${Math.round(
                  profiles.reduce((acc, p) => acc + (p.totalEvents || 1), 0) / Math.max(1, profiles.length)
                )} ev/user`
              : "—"}
          </div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Average lifetime events per profile</span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search by email, name, or distinct ID..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 pl-10 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none transition"
        />
        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        {isSearching && <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />}
      </div>

      {/* Profiles Table */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 overflow-hidden">
        {profiles.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-500 mx-auto">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-200">No Identified Users Yet</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
              Call <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-indigo-300 font-mono">trackme.identify("user_id", &#123; name: "...", email: "..." &#125;)</code> in your web app to link visitors with rich profiles and timelines.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {profiles.map((user) => {
              const displayName = user.name || user.email || user.distinctId;
              const initials = displayName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              const traitsEntries = Object.entries(user.traits || {}).slice(0, 3);

              return (
                <div
                  key={user.id}
                  onClick={() => openUserDrawer(user)}
                  className="flex items-center justify-between p-4 hover:bg-white/[0.02] cursor-pointer transition text-xs group"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-100 truncate group-hover:text-indigo-400 transition">
                          {displayName}
                        </span>
                        {user.email && user.name && (
                          <span className="text-[11px] text-zinc-400 truncate">{user.email}</span>
                        )}
                        <span className="font-mono text-[10px] text-zinc-500 bg-white/[0.03] px-1.5 py-0.5 rounded border border-white/5">
                          ID: {user.distinctId}
                        </span>
                      </div>

                      {/* Traits Preview */}
                      {traitsEntries.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {traitsEntries.map(([k, v]) => (
                            <span
                              key={k}
                              className="text-[10px] text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06]"
                            >
                              <strong className="text-zinc-500">{k}:</strong> {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0 ml-4">
                    <div className="text-right hidden sm:block">
                      <div className="text-zinc-200 font-medium">{user.totalSessions} sessions</div>
                      <div className="text-[11px] text-zinc-500">{user.totalEvents} events</div>
                    </div>

                    <div className="text-right hidden md:block">
                      <div className="text-zinc-300">{formatRelativeTime(user.lastSeenAt)}</div>
                      <div className="text-[10px] text-zinc-500">Last active</div>
                    </div>

                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* User Timeline Drawer / Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm p-0 animate-in fade-in duration-200">
          <div
            className="w-full max-w-xl h-full bg-zinc-950 border-l border-white/10 p-6 overflow-y-auto space-y-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300"
          >
            <div className="space-y-6">
              {/* Drawer Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-300 text-sm font-bold">
                    {(selectedUser.name || selectedUser.distinctId).slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-zinc-100">
                      {selectedUser.name || selectedUser.email || selectedUser.distinctId}
                    </h2>
                    <span className="font-mono text-xs text-zinc-400">
                      distinct_id: {selectedUser.distinctId}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* User Overview Badges */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <span className="text-zinc-500 block text-[10px]">First Seen</span>
                  <span className="font-medium text-zinc-200">
                    {formatRelativeTime(selectedUser.firstSeenAt)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <span className="text-zinc-500 block text-[10px]">Last Seen</span>
                  <span className="font-medium text-zinc-200">
                    {formatRelativeTime(selectedUser.lastSeenAt)}
                  </span>
                </div>
              </div>

              {/* Custom Traits Box */}
              {Object.keys(selectedUser.traits || {}).length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-indigo-400" />
                    Customer Traits
                  </span>
                  <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.08] flex flex-wrap gap-2">
                    {Object.entries(selectedUser.traits).map(([key, val]) => (
                      <div
                        key={key}
                        className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-300 flex items-center gap-1.5"
                      >
                        <span className="text-zinc-500 font-mono text-[11px]">{key}:</span>
                        <strong className="text-zinc-200">{String(val)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Chronological Activity Timeline */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    Activity Stream ({timeline.length} events)
                  </span>
                  {loadingTimeline && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
                </div>

                {loadingTimeline ? (
                  <div className="p-8 text-center text-xs text-zinc-500">Loading user events…</div>
                ) : timeline.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-500 rounded-xl border border-dashed border-white/10">
                    No recent ClickHouse events found for this distinct ID.
                  </div>
                ) : (
                  <div className="relative pl-4 space-y-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-white/10">
                    {timeline.map((event) => {
                      const isPageview = event.type === "pageview";
                      const isIdentify = event.type === "identify";
                      const isGoal = event.properties?.eventName === "goal_completed" || !!event.properties?.goal;

                      return (
                        <div key={event.eventId} className="relative text-xs space-y-1">
                          {/* Dot */}
                          <div
                            className={`absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 ${
                              isGoal
                                ? "bg-amber-400"
                                : isIdentify
                                ? "bg-purple-400"
                                : isPageview
                                ? "bg-indigo-400"
                                : "bg-emerald-400"
                            }`}
                          />

                          <div className="flex items-center justify-between">
                            <span className="font-medium text-zinc-200 flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                                  isGoal
                                    ? "bg-amber-500/10 text-amber-400"
                                    : isIdentify
                                    ? "bg-purple-500/10 text-purple-400"
                                    : isPageview
                                    ? "bg-indigo-500/10 text-indigo-400"
                                    : "bg-emerald-500/10 text-emerald-400"
                                }`}
                              >
                                {isGoal ? "Goal" : event.type}
                              </span>
                              <span className="truncate max-w-[260px] font-mono text-[11px]">
                                {event.path || event.eventName}
                              </span>
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              {formatRelativeTime(event.timestamp)}
                            </span>
                          </div>

                          {/* Event Metadata (Browser, City, Device) */}
                          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                            {event.browser && <span>{event.browser} / {event.os}</span>}
                            {event.city && <span>📍 {event.city}, {event.country}</span>}
                            {event.title && <span className="truncate max-w-[150px]">"{event.title}"</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() => setSelectedUser(null)}
              className="w-full mt-4 text-xs font-semibold"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
