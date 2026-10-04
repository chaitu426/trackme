"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { formatNumber } from "@/lib/format";
import type { RealtimeSnapshot } from "@/lib/realtime";

type Props = {
  siteId: string;
  initial: RealtimeSnapshot;
};

export function RealtimeLive({ siteId, initial }: Props) {
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/v1/sites/${siteId}/realtime/stream`);

    const onSnapshot = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as RealtimeSnapshot;
        setSnapshot(data);
        setConnected(true);
      } catch {
        // ignore malformed frames
      }
    };

    source.addEventListener("snapshot", onSnapshot as EventListener);
    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      source.removeEventListener("snapshot", onSnapshot as EventListener);
      source.close();
    };
  }, [siteId]);

  const maxPageVisitors = Math.max(...snapshot.pages.map((p) => p.visitors), 1);

  return (
    <>
      {/* Top Section Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.06] pb-4 text-left">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-50">Realtime Monitor</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 pulse-live" : "bg-amber-400"}`} />
              {connected ? "LIVE FEED" : "CONNECTING"}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Active concurrent sessions detected in the last 5 minutes · Zero-cookie telemetry
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {/* Active Visitors KPI Card: Heading in upper-left corner */}
        <Card className="flex flex-col justify-between border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.04] to-transparent p-5 text-left">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 select-none font-sans flex items-center gap-1.5">
                <Radio className="h-3 w-3" />
                Active Visitors
              </span>
              <p className="mt-0.5 text-xs text-zinc-400">Live concurrent visitors</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-400 pulse-live" />
          </div>

          <div className="my-5">
            <span className="text-5xl font-bold tracking-tight text-zinc-50 tabular-nums">
              {formatNumber(snapshot.activeVisitors)}
            </span>
            <p className="mt-1.5 text-xs text-zinc-400">
              Redis memory store · sliding 5m window
            </p>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2 text-[11px] text-zinc-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Event Stream
            </span>
            <span className="font-mono text-[10px] text-emerald-400 font-semibold tracking-wider">ACTIVE</span>
          </div>
        </Card>

        {/* Realtime Pages Card: Heading in upper-left corner */}
        <Card className="md:col-span-2">
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3">
            <div>
              <CardTitle>Currently Visited Pages</CardTitle>
              <CardDescription>Live pages with active session activity</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
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
    </>
  );
}
