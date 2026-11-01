"use client";

import { GlyphField } from "@trackme/landing";
import { PageHeader } from "@/components/ui/page-header";
import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { formatNumber } from "@/lib/format";
import type { RealtimeSnapshot } from "@/lib/realtime";

type Props = {
  siteId: string;
  initial: RealtimeSnapshot;
};

type VisitorTrend =
  | { direction: "up" | "down"; percent: number }
  | { direction: "up"; isNew: true };

function formatTrendPercent(percent: number): string {
  if (percent > 0 && percent < 0.1) return "<0.1";
  return percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
}

export function RealtimeLive({ siteId, initial }: Props) {
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(initial);
  const [connected, setConnected] = useState(false);
  const [visitorTrend, setVisitorTrend] = useState<VisitorTrend | null>(null);
  const previousVisitors = useRef(initial.activeVisitors);

  useEffect(() => {
    const source = new EventSource(`/api/v1/sites/${siteId}/realtime/stream`);

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
  const isNewVisitorTrend = visitorTrend?.direction === "up" && "isNew" in visitorTrend;

  return (
    <>
      <PageHeader
        title="Realtime"
        art="pulse"
        actions={
          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-raised px-3 text-xs text-zinc-200">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[#4cc38a] pulse-live" : "bg-zinc-500"}`} />
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
                className={`font-mono text-xs tabular-nums ${visitorTrend.direction === "up" ? "text-[#4cc38a]" : "text-[#e5484d]"}`}
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
              <span className="h-1.5 w-1.5 rounded-full bg-[#4cc38a]" />
              Event stream
            </span>
            <span className="font-mono text-xs text-zinc-300">active</span>
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
    </>
  );
}
