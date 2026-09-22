"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import type { RealtimeSnapshot } from "@/lib/realtime";

type Props = {
  siteId: string;
  initial: RealtimeSnapshot;
};

/**
 * Live realtime panel fed by SSE. Falls back to the SSR snapshot if the
 * stream is unavailable.
 */
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

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Realtime Activity</h1>
          <p className="text-sm text-slate-400">
            Active visitors within the last 5 minutes — live via SSE.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span
            className={`flex h-3 w-3 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
          />
          <span className={`text-sm font-semibold ${connected ? "text-emerald-400" : "text-amber-400"}`}>
            {connected ? "Live" : "Reconnecting…"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="flex flex-col items-center justify-center p-8 bg-[#0f121d] border-emerald-500/20">
          <span className="text-6xl font-black text-white tracking-tighter">
            {formatNumber(snapshot.activeVisitors)}
          </span>
          <span className="text-sm font-semibold text-emerald-400 mt-2">Active Visitors Right Now</span>
          <span className="text-xs text-slate-500 mt-1">Redis ZSET index · 1s SSE</span>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Currently Viewed Pages</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {snapshot.pages.length === 0 ? (
              <p className="text-sm text-slate-500">No active visitors right now.</p>
            ) : (
              snapshot.pages.map((p) => (
                <div
                  key={p.path}
                  className="flex justify-between items-center py-2 border-b border-slate-800/60 text-sm"
                >
                  <span className="font-mono text-xs text-slate-200">{p.path}</span>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-slate-400">
                      Geo: {p.countries.length > 0 ? p.countries.join(", ") : "Unknown"}
                    </span>
                    <Badge variant="success">
                      {p.visitors} {p.visitors === 1 ? "visitor" : "visitors"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
