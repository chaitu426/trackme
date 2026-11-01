import { notFound } from "next/navigation";
import { getRecentEvents } from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    <div className="w-full space-y-4">
      <RealtimeLive siteId={site.id} initial={snapshot} />

      <Card>
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <CardTitle>Event Stream Log</CardTitle>
            <CardDescription>Live event stream tail · last 20 ingested events</CardDescription>
          </div>
          <span className="font-mono text-xs text-zinc-500 font-medium">
            Telemetry Feed
          </span>
        </CardHeader>
        <div className="space-y-1 pt-2 font-mono text-xs">
          {recentEvents.length === 0 ? (
            <p className="py-8 text-center font-sans text-xs text-zinc-500">No events received yet.</p>
          ) : (
            recentEvents.map((e) => (
              <div
                key={e.eventId}
                className="flex items-center justify-between rounded-lg px-3 py-2 transition hover:bg-white/[0.04]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-zinc-500">{formatRelativeTime(e.occurredAt)}</span>
                  <Badge variant={e.type === "custom" ? "outline" : "default"} className="shrink-0 text-xs">
                    {e.type === "custom" ? `custom:${e.eventName}` : e.type}
                  </Badge>
                  <span className="max-w-[280px] truncate text-zinc-200">{e.path}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-white/[0.04] px-2 py-0.5 font-medium text-zinc-400">
                    {e.country || "??"}
                  </span>
                  <span>·</span>
                  <span>{[e.browser, e.os].filter(Boolean).join(" / ") || "Unknown"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
