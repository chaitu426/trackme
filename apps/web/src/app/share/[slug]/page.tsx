import { notFound } from "next/navigation";
import { getOverviewMetrics, getBreakdown } from "@trackme/analytics";
import { StatsCard } from "@/components/ui/stats-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPublicSite } from "@/lib/tenancy";
import { getActiveVisitorCount } from "@/lib/realtime";
import { buildMetricRequest } from "@/lib/metrics";
import { resolveDateRange } from "@/lib/date-range";
import { formatNumber, formatPercent, formatDuration } from "@/lib/format";

export default async function PublicShareDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getPublicSite(slug);
  if (!site) {
    notFound();
  }

  const { current } = resolveDateRange("30d");
  const request = buildMetricRequest(site.workspaceId, site.id, current, { limit: 5 });

  const [metrics, topPages, topReferrers, activeVisitors] = await Promise.all([
    getOverviewMetrics(request),
    getBreakdown(request, "path"),
    getBreakdown(request, "referrer"),
    getActiveVisitorCount(site.id),
  ]);

  return (
    <div className="min-h-screen bg-[#090a0f] text-slate-100 p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Public Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-6 gap-4">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
              G
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold text-white">Public Analytics: {site.domain}</h1>
                <Badge variant="outline">Read-Only</Badge>
              </div>
              <p className="text-xs text-slate-400">Powered by Growth Intelligence Platform (Privacy-First)</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-400 font-semibold">
              {formatNumber(activeVisitors)} Active {activeVisitors === 1 ? "Visitor" : "Visitors"}
            </span>
          </div>
        </div>

        {/* High-level KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatsCard title="Visitors (30d)" value={formatNumber(metrics.visitors)} />
          <StatsCard title="Pageviews (30d)" value={formatNumber(metrics.pageviews)} />
          <StatsCard title="Avg Duration" value={formatDuration(metrics.avgDurationSeconds)} />
          <StatsCard title="Bounce Rate" value={formatPercent(metrics.bounceRatePercentage)} />
        </div>

        {/* Public Breakdown Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Top Content</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              {topPages.items.length === 0 ? (
                <p className="text-xs text-slate-500">No pageviews recorded yet.</p>
              ) : (
                topPages.items.map((p) => (
                  <div
                    key={p.name}
                    className="flex justify-between items-center py-1.5 border-b border-slate-800/60 text-xs font-mono"
                  >
                    <span className="text-slate-300">{p.name}</span>
                    <span className="text-slate-200 font-sans font-semibold">
                      {formatNumber(p.pageviews)} ({formatPercent(p.percentage)})
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Channels</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              {topReferrers.items.length === 0 ? (
                <p className="text-xs text-slate-500">No referrer data recorded yet.</p>
              ) : (
                topReferrers.items.map((c) => (
                  <div
                    key={c.name}
                    className="flex justify-between items-center py-1.5 border-b border-slate-800/60 text-xs"
                  >
                    <span className="text-slate-300">{c.name}</span>
                    <span className="text-slate-200 font-semibold">
                      {formatNumber(c.visitors)} ({formatPercent(c.percentage)})
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
