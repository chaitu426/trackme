import { notFound } from "next/navigation";
import { getRecentEvents } from "@trackme/analytics";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RealtimeLive } from "@/components/realtime-live";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { getRealtimeSnapshot } from "@/lib/realtime";
import { formatRelativeTime } from "@/lib/format";

export default async function SiteRealtimeReport({
  params,
}: {
  params: Promise<{ workspace: string; site: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  const [snapshot, recentEvents] = await Promise.all([
    getRealtimeSnapshot(site.id),
    getRecentEvents(workspace.id, site.id, 20),
  ]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center space-x-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Live Visitor Stream</h1>
        <Badge variant="live">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span>live</span>
        </Badge>
      </div>

      {/* ── Live active count component ── */}
      <RealtimeLive siteId={site.id} initial={snapshot} />

      {/* ── Recent Events Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent Events (Stream Tail · last 20)</CardTitle>
        </CardHeader>
        <div className="space-y-1.5 font-mono text-[11px]">
          {recentEvents.length === 0 ? (
            <p className="text-xs text-zinc-400 font-sans py-4 text-center">No events received yet.</p>
          ) : (
            recentEvents.map((e) => (
              <div
                key={e.eventId}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200/80 hover:bg-zinc-100/60 transition"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <span className="text-zinc-400 shrink-0">{formatRelativeTime(e.occurredAt)}</span>
                  <Badge variant={e.type === "custom" ? "warning" : "default"} className="shrink-0 text-[10px]">
                    {e.type === "custom" ? `custom:${e.eventName}` : e.type}
                  </Badge>
                  <span className="text-zinc-700 truncate max-w-[200px]">{e.path}</span>
                </div>
                <div className="flex items-center space-x-2.5 text-zinc-400 text-[10px] shrink-0">
                  <span>{e.country || "??"}</span>
                  <span className="text-zinc-300">·</span>
                  <span>{[e.browser, e.os].filter(Boolean).join("/") || "Unknown"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
