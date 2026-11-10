"use client";

import { GlyphField } from "@trackme/landing";
import { PageHeader } from "@/components/ui/page-header";
import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import type { RealtimeSnapshot } from "@/lib/realtime";

export type RealtimeEvent = {
  eventId: string;
  type: string;
  eventName: string;
  path: string;
  country: string;
  browser: string;
  os: string;
  occurredAt: string;
};

type Props = {
  siteId: string;
  initial: RealtimeSnapshot;
  initialEvents: RealtimeEvent[];
};

/** Fewest milliseconds between two refetches of the event tail, however fast snapshots arrive. */
const EVENTS_MIN_INTERVAL_MS = 3_000;

type VisitorTrend =
  | { direction: "up" | "down"; percent: number }
  | { direction: "up"; isNew: true };

function formatTrendPercent(percent: number): string {
  if (percent > 0 && percent < 0.1) return "<0.1";
  return percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
}

export function RealtimeLive({ siteId, initial, initialEvents }: Props) {
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(initial);
  const [events, setEvents] = useState<RealtimeEvent[]>(initialEvents);
  const [, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [visitorTrend, setVisitorTrend] = useState<VisitorTrend | null>(null);
  const previousVisitors = useRef(initial.activeVisitors);

  useEffect(() => {
    const source = new EventSource(`/api/v1/sites/${siteId}/realtime/stream`);
    let lastFetch = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;

    // The stream only carries visitor counts, so the event tail is refetched when it changes,
    // at most once per EVENTS_MIN_INTERVAL_MS.
    const loadEvents = async () => {
      pending = null;
      lastFetch = Date.now();
      inflight?.abort();
      inflight = new AbortController();
      try {
        const res = await fetch(`/api/v1/sites/${siteId}/realtime/events`, { signal: inflight.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { events?: RealtimeEvent[] };
        if (body.events) setEvents(body.events);
      } catch {
        // keep the previous tail; the next snapshot retries
      }
    };
    const scheduleEvents = () => {
      if (pending) return;
      const wait = Math.max(0, lastFetch + EVENTS_MIN_INTERVAL_MS - Date.now());
      pending = setTimeout(() => void loadEvents(), wait);
    };

    const onSnapshot = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as RealtimeSnapshot;
        const previous = previousVisitors.current;
        previousVisitors.current = data.activeVisitors;
        if (data.activeVisitors !== previous) {
          if (previous === 0 && data.activeVisitors > 0) {
            setVisitorTrend({ direction: "up", isNew: true });
          } else if (previous > 0) {
            const change = ((data.activeVisitors - previous) / previous) * 100;
            setVisitorTrend({
              direction: change > 0 ? "up" : "down",
              percent: Math.abs(change),
            });
          }
        }
        setSnapshot(data);
        setConnected(true);
        scheduleEvents();
      } catch {
        // ignore malformed frames
      }
    };

    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.onerror = () => {
      setConnected(false);
    };
    // Re-render every 10s so "12s ago" labels keep counting between snapshots.
    const ticker = setInterval(() => setTick((n) => n + 1), 10_000);
    // A returning visitor's pageview does not change the visitor counts, so also refresh on a timer.
    const poll = setInterval(scheduleEvents, 15_000);

    return () => {
      source.removeEventListener("snapshot", onSnapshot as EventListener);
      source.close();
      clearInterval(ticker);
      clearInterval(poll);
      if (pending) clearTimeout(pending);
      inflight?.abort();
    };
  }, [siteId]);

  const maxPageVisitors = Math.max(...snapshot.pages.map((p) => p.visitors), 1);
  const isNewVisitorTrend = visitorTrend?.direction === "up" && "isNew" in visitorTrend;

  return (
    <>
      <PageHeader
        title="Realtime"
        art="pulse"
        actions={
          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-raised px-3 text-xs text-zinc-200">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good pulse-live" : "bg-zinc-500"}`} />
            {connected ? "Live" : "Connecting"}
          </span>
        }
      >
        Visitors active in the last 5 minutes, counted without cookies
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="relative flex flex-col justify-between overflow-hidden p-5 text-left">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[70%] [mask-image:linear-gradient(to_right,transparent,black_60%)]" aria-hidden="true">
            <GlyphField variant="pulse" cell={9} strength={0.55} />
          </div>
          <div className="relative flex items-start justify-between gap-2">
            <div>
              <span className="flex items-center gap-2 text-sm text-zinc-400">
                <Radio className="h-4 w-4" />
                Active visitors
              </span>
            </div>
            {visitorTrend && (
              <span
                aria-label={
                  isNewVisitorTrend
                    ? "New visitors since the previous update"
                    : `Visitors ${visitorTrend.direction === "up" ? "increased" : "decreased"} ${formatTrendPercent(visitorTrend.percent)} percent since the previous update`
                }
                className={`font-mono text-xs tabular-nums ${visitorTrend.direction === "up" ? "text-good" : "text-bad"}`}
              >
                {visitorTrend.direction === "up" ? "↑" : "↓"} {isNewVisitorTrend ? "New" : `${formatTrendPercent(visitorTrend.percent)}%`}
              </span>
            )}
          </div>

          <div className="relative my-8">
            <span className="text-5xl font-medium text-zinc-50 tabular-nums">{formatNumber(snapshot.activeVisitors)}</span>
            <p className="mt-2 text-xs text-zinc-500">Sliding 5-minute window</p>
          </div>

          <div className="relative flex items-center justify-between rounded-lg border border-white/[0.08] bg-sidebar px-3 py-2 text-xs text-zinc-400">
            <span className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-zinc-500"}`} />
              Event stream
            </span>
            <span className="font-mono text-xs text-zinc-300">{connected ? "connected" : "reconnecting…"}</span>
          </div>
        </Card>

        {/* Realtime Pages Card: Heading in upper-left corner */}
        <Card className="md:col-span-2">
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3">
            <div>
              <CardTitle>Currently Visited Pages</CardTitle>
              <CardDescription>Live pages with active session activity</CardDescription>
            </div>
            <span className="font-mono text-xs text-zinc-500 font-medium">
              Active Visitors
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={snapshot.pages.map((p) => ({
                name: p.path,
                value: p.visitors,
                percentage: (p.visitors / maxPageVisitors) * 100,
                meta: p.countries.length > 0 ? p.countries.join(", ") : "Unknown geo",
              }))}
              empty="No active visitors detected on site right now."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <CardTitle>Event Stream Log</CardTitle>
            <CardDescription>Newest events first · updates as visitors arrive</CardDescription>
          </div>
          <span className="font-mono text-xs font-medium text-zinc-500">Last {events.length || 20}</span>
        </CardHeader>
        <div className="space-y-1 pt-2 font-mono text-xs">
          {events.length === 0 ? (
            <p className="py-8 text-center font-sans text-xs text-zinc-500">
              No events yet. They appear here within seconds of a visit.
            </p>
          ) : (
            events.map((e) => (
              <div
                key={e.eventId}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition hover:bg-white/[0.04]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-14 shrink-0 text-zinc-500">{formatRelativeTime(e.occurredAt)}</span>
                  <Badge variant={e.type === "custom" ? "outline" : "default"} className="shrink-0 text-xs">
                    {e.type === "custom" ? `custom:${e.eventName}` : e.type}
                  </Badge>
                  <span className="min-w-0 truncate text-zinc-200">{e.path}</span>
                </div>
                <div className="hidden shrink-0 items-center gap-2 text-xs text-zinc-500 sm:flex">
                  <span className="rounded bg-white/[0.04] px-2 py-0.5 font-medium text-zinc-400">{e.country || "??"}</span>
                  <span>·</span>
                  <span>{[e.browser, e.os].filter(Boolean).join(" / ") || "Unknown"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
