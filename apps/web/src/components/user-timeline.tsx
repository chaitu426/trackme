"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, FileText, Loader2, MousePointerClick, Pin } from "lucide-react";
import type { TimelineItem, UserSummary } from "@trackme/analytics";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

type Filter = "all" | "errors" | "events" | "pages";
const FILTERS: Array<{ id: Filter; label: string; query: string }> = [
  { id: "all", label: "Everything", query: "" },
  { id: "errors", label: "Errors", query: "kinds=error" },
  { id: "events", label: "Events", query: "kinds=event" },
  { id: "pages", label: "Pages", query: "kinds=page" },
];

const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const day = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });

const KIND_ICON: Record<string, React.ReactNode> = {
  page: <FileText className="h-3.5 w-3.5" />,
  event: <MousePointerClick className="h-3.5 w-3.5" />,
  error: <AlertTriangle className="h-3.5 w-3.5" />,
};
const KIND_LABEL: Record<string, string> = { page: "Page", event: "Event", error: "Error" };

interface Response {
  items: TimelineItem[];
  nextCursor: string | null;
  summary: UserSummary | null;
}

/** A person's pages, events and errors on one clock, newest first, with filters and paging. */
export function UserTimeline({
  siteId,
  distinctId,
  workspaceSlug,
  siteDomain,
}: {
  siteId: string;
  distinctId: string;
  workspaceSlug: string;
  siteDomain: string;
}) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [items, setItems] = React.useState<TimelineItem[]>([]);
  const [summary, setSummary] = React.useState<UserSummary | null>(null);
  const [next, setNext] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const generation = React.useRef(0);

  const url = React.useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams(FILTERS.find((f) => f.id === filter)!.query);
      if (cursor) params.set("cursor", cursor);
      return `/api/v1/sites/${siteId}/people/${encodeURIComponent(distinctId)}/timeline?${params.toString()}`;
    },
    [siteId, distinctId, filter]
  );

  const load = React.useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(url());
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Response;
      if (mine !== generation.current) return;
      setItems(body.items);
      setNext(body.nextCursor);
      if (body.summary) setSummary(body.summary);
    } catch {
      if (mine === generation.current) setFailed(true);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [url]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function loadOlder() {
    if (!next) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const res = await fetch(url(next));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Response;
      if (mine !== generation.current) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.eventId));
        return [...current, ...body.items.filter((item) => !seen.has(item.eventId))];
      });
      setNext(body.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function copyLink() {
    const link = `${window.location.origin}/${workspaceSlug}/sites/${siteDomain}/people?q=${encodeURIComponent(distinctId)}`;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const errorHref = (ref: string) => `/${workspaceSlug}/sites/${siteDomain}/errors/${ref}`;

  // Consecutive rows of one session form a group, so a visit reads as one unit.
  const groups = React.useMemo(() => {
    const out: Array<{ key: string; items: TimelineItem[] }> = [];
    for (const item of items) {
      const last = out[out.length - 1];
      if (last && last.key === item.sessionKey) last.items.push(item);
      else out.push({ key: item.sessionKey, items: [item] });
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-4">
      {summary && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Sessions (90d)", summary.sessions.toLocaleString()],
              ["Errors (90d)", summary.errors.toLocaleString()],
              ["Release", summary.release || "–"],
              ["Where", [summary.country, summary.device].filter(Boolean).join(" · ") || "–"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-xs font-medium text-zinc-500">{k}</p>
                <p className="mt-1 truncate text-[13px] font-medium tabular-nums text-zinc-100">{v}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
            <p className="flex items-center gap-2 font-medium text-zinc-400">
              <Pin className="h-3.5 w-3.5" /> Key moments
            </p>
            <ul className="space-y-1 text-zinc-300">
              <li>First seen {summary.firstSeen ?? "–"}</li>
              <li>Last seen {summary.lastSeen ? formatRelativeTime(summary.lastSeen) : "–"}</li>
              {summary.lastError && (
                <li>
                  Last error {formatRelativeTime(summary.lastError.at)}:{" "}
                  <Link href={errorHref(summary.lastError.ref)} className="text-zinc-100 underline decoration-white/20 underline-offset-2 hover:decoration-white/60">
                    {summary.lastError.summary}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Show" className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] p-0.5 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${filter === f.id ? "bg-raised text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.05]"
          title="Copy a link that opens this person"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[#4cc38a]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading timeline</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : failed && items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e5484d]/30 bg-[#e5484d]/5 p-6 text-center">
          <p className="text-xs text-[#e5484d]">The timeline could not be loaded.</p>
          <button type="button" onClick={() => void load()} className="mt-2 rounded-md border border-white/[0.1] px-3 py-1 text-xs text-zinc-200 hover:bg-white/[0.05]">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-500">
          {filter === "all"
            ? "Nothing in the last 90 days. The timeline starts when a person is identified."
            : `No ${FILTERS.find((f) => f.id === filter)!.label.toLowerCase()} in the last 90 days.`}
        </div>
      ) : (
        <ol className="space-y-3">
          {groups.map((group, g) => {
            const first = group.items[group.items.length - 1]!;
            const last = group.items[0]!;
            return (
              <li key={`${group.key}-${g}`} className="overflow-hidden rounded-xl border border-white/[0.07]">
                <details open={g === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
                    <span>
                      {day.format(new Date(last.at))} · {time.format(new Date(first.at))}
                      {first.at !== last.at ? `–${time.format(new Date(last.at))}` : ""}
                    </span>
                    <span>{group.items.length} {group.items.length === 1 ? "item" : "items"}</span>
                  </summary>
                  <ul className="divide-y divide-white/[0.04]">
                    {group.items.map((item) => (
                      <li key={item.eventId} className="flex items-start gap-3 px-3 py-2 text-xs">
                        <span
                          className={`mt-0.5 flex shrink-0 items-center gap-1 ${item.severity === "error" ? "text-[#e5484d]" : item.severity === "warning" ? "text-amber-400" : "text-zinc-500"}`}
                          title={KIND_LABEL[item.kind] ?? item.kind}
                        >
                          {KIND_ICON[item.kind] ?? null}
                          <span className="sr-only">{KIND_LABEL[item.kind] ?? item.kind}{item.severity !== "info" ? `, ${item.severity}` : ""}</span>
                        </span>
                        <span className="min-w-0 flex-1 break-words text-zinc-200">
                          {item.kind === "error" && item.ref ? (
                            <Link href={errorHref(item.ref)} className="underline decoration-white/20 underline-offset-2 hover:decoration-white/60">
                              {item.summary}
                            </Link>
                          ) : (
                            <span className={item.kind === "page" ? "font-mono" : ""}>{item.summary}</span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums text-zinc-500" title={new Date(item.at).toLocaleString()}>
                          {time.format(new Date(item.at))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      {next && !loading && (
        <button
          type="button"
          onClick={() => void loadOlder()}
          disabled={loadingMore}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] py-2 text-xs text-zinc-300 transition-colors hover:bg-white/[0.04] disabled:opacity-60"
        >
          {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Load older
        </button>
      )}
    </div>
  );
}
