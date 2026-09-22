import Link from "next/link";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { getOverviewMetrics, getBreakdown } from "@trackme/analytics";
import { StatsCard } from "@/components/ui/stats-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requirePrimarySite } from "@/lib/tenancy";
import { getActiveVisitorCount } from "@/lib/realtime";
import { buildMetricRequest } from "@/lib/metrics";
import { RANGE_OPTIONS, parseRangeKey, resolveDateRange, percentChange } from "@/lib/date-range";
import { formatNumber, formatPercent, formatChange, formatDuration } from "@/lib/format";

export default async function OverviewDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug } = await params;
  const { range: rawRange } = await searchParams;
  const range = parseRangeKey(rawRange);

  let context: Awaited<ReturnType<typeof requirePrimarySite>>;
  try {
    context = await requirePrimarySite(user.id, workspaceSlug);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  const { current, previous } = resolveDateRange(range);
  const currentRequest = buildMetricRequest(workspace.id, site.id, current, { limit: 8 });
  const previousRequest = buildMetricRequest(workspace.id, site.id, previous, { limit: 8 });

  const [currentMetrics, previousMetrics, topPages, topReferrers, activeVisitors] = await Promise.all([
    getOverviewMetrics(currentRequest),
    getOverviewMetrics(previousRequest),
    getBreakdown(currentRequest, "path"),
    getBreakdown(currentRequest, "referrer"),
    getActiveVisitorCount(site.id),
  ]);

  const pagesPerSession =
    currentMetrics.sessions > 0
      ? (currentMetrics.pageviews / currentMetrics.sessions).toFixed(1)
      : "–";

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Traffic & Growth Overview
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Period-accurate cookieless analytics for{" "}
            <span className="font-mono font-semibold text-zinc-700">{site.domain}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Date Range Pill Selector */}
          <div className="flex items-center p-0.5 bg-white border border-zinc-200/80 rounded-xl shadow-xs text-xs font-medium text-zinc-600">
            {RANGE_OPTIONS.map((option) => (
              <Link
                key={option.key}
                href={`?range=${option.key}`}
                className={`px-3 py-1.5 rounded-lg transition ${
                  option.key === range
                    ? "bg-zinc-900 text-white shadow-xs"
                    : "hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>

          {/* Live Visitors Badge */}
          <Badge variant="live" className="h-8 px-3">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-ping" />
            <span className="font-bold">{formatNumber(activeVisitors)}</span>
            <span className="font-sans text-emerald-700/90">live now</span>
          </Badge>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Unique Visitors"
          value={formatNumber(currentMetrics.visitors)}
          change={formatChange(percentChange(currentMetrics.visitors, previousMetrics.visitors))}
          isPositive={currentMetrics.visitors >= previousMetrics.visitors}
          subtitle={`vs ${formatNumber(previousMetrics.visitors)} prior period`}
          badge="uniqExact"
        />
        <StatsCard
          title="Total Pageviews"
          value={formatNumber(currentMetrics.pageviews)}
          change={formatChange(percentChange(currentMetrics.pageviews, previousMetrics.pageviews))}
          isPositive={currentMetrics.pageviews >= previousMetrics.pageviews}
          subtitle={`${pagesPerSession} pages per session`}
        />
        <StatsCard
          title="Avg Visit Duration"
          value={formatDuration(currentMetrics.avgDurationSeconds)}
          change={formatChange(
            percentChange(currentMetrics.avgDurationSeconds, previousMetrics.avgDurationSeconds)
          )}
          isPositive={currentMetrics.avgDurationSeconds >= previousMetrics.avgDurationSeconds}
          subtitle="First → last event in session"
        />
        <StatsCard
          title="Bounce Rate"
          value={formatPercent(currentMetrics.bounceRatePercentage)}
          change={formatChange(
            percentChange(currentMetrics.bounceRatePercentage, previousMetrics.bounceRatePercentage)
          )}
          isPositive={currentMetrics.bounceRatePercentage <= previousMetrics.bounceRatePercentage}
          subtitle="Sessions with exactly 1 pageview"
        />
      </div>

      {/* ── Breakdown Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Pages */}
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle>Top Pages</CardTitle>
            <span className="text-[11px] text-zinc-400 font-mono">Pageviews</span>
          </CardHeader>
          <div className="space-y-2.5">
            {topPages.items.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center">
                No pageviews recorded in this range yet.
              </p>
            ) : (
              topPages.items.map((item) => (
                <div key={item.name} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-zinc-700 truncate max-w-[200px]">{item.name}</span>
                    <span className="font-semibold text-zinc-900 text-xs font-mono ml-2 shrink-0">
                      {formatNumber(item.pageviews)}{" "}
                      <span className="text-zinc-400 font-normal">({formatPercent(item.percentage)})</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zinc-900 rounded-full transition-all"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Top Referrers */}
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle>Referral & Acquisition</CardTitle>
            <span className="text-[11px] text-zinc-400 font-mono">Visitors</span>
          </CardHeader>
          <div className="space-y-2.5">
            {topReferrers.items.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center">
                No referrer data recorded in this range yet.
              </p>
            ) : (
              topReferrers.items.map((item) => (
                <div key={item.name} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-700 truncate max-w-[200px]">{item.name || "direct"}</span>
                    <span className="font-semibold text-zinc-900 text-xs font-mono ml-2 shrink-0">
                      {formatNumber(item.visitors)}{" "}
                      <span className="text-zinc-400 font-normal">({formatPercent(item.percentage)})</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── Footer note on methodology ── */}
      <div className="flex items-start space-x-2 pt-2 pb-4 text-xs text-zinc-400 border-t border-zinc-200/60">
        <Info className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0" />
        <span>
          <strong className="text-zinc-600">Period Uniques</strong>: counted via{" "}
          <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-zinc-700">uniqExact()</code> across the full date window — not a sum of daily uniques.
          IP addresses are hashed with an hourly rotating salt before ClickHouse ingestion. No cookies or persistent identifiers stored.
        </span>
      </div>
    </div>
  );
}
