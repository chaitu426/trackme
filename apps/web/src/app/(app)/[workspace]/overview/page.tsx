import { notFound, redirect } from "next/navigation";
import { FileText, Globe2, Info, Compass, ShieldCheck } from "lucide-react";
import { getOverviewMetrics, getBreakdown, getTopJourneys, getTimeSeries, getWebVitalsSummary } from "@trackme/analytics";
import { StatsCard } from "@/components/ui/stats-card";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RankingList } from "@/components/ui/ranking-list";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { VitalsPulse } from "@/components/vitals-pulse";
import { requireUser } from "@/lib/auth";
import { requirePrimarySite } from "@/lib/tenancy";
import { getActiveVisitorCount } from "@/lib/realtime";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, percentChange } from "@/lib/date-range";
import { formatNumber, formatPercent, formatChange, formatDuration } from "@/lib/format";
import type { DimensionFilter } from "@trackme/contracts";

export default async function OverviewDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ range?: string; country?: string; device?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug } = await params;
  const { range: rawRange, country: rawCountry, device: rawDevice } = await searchParams;
  const range = parseRangeKey(rawRange);
  const country = /^[A-Z]{2}$/.test(rawCountry ?? "") ? rawCountry : undefined;
  const device: "desktop" | "mobile" | "tablet" | undefined =
    rawDevice === "desktop" || rawDevice === "mobile" || rawDevice === "tablet" ? rawDevice : undefined;

  const filters: DimensionFilter | undefined = (() => {
    const next: DimensionFilter = {};
    if (country) next.country = country;
    if (device) next.device = device;
    return Object.keys(next).length > 0 ? next : undefined;
  })();

  let context: Awaited<ReturnType<typeof requirePrimarySite>>;
  try {
    context = await requirePrimarySite(user.id, workspaceSlug);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "NO_SITES") {
      redirect(`/${workspaceSlug}/settings/sites`);
    }
    notFound();
  }
  const { workspace, site } = context;

  const { current, previous } = resolveDateRange(range);
  const currentRequest = buildMetricRequest(workspace.id, site.id, current, {
    limit: 10,
    ...(filters ? { filters } : {}),
  });
  const previousRequest = buildMetricRequest(workspace.id, site.id, previous, {
    limit: 10,
    ...(filters ? { filters } : {}),
  });
  const filterCatalogRequest = buildMetricRequest(workspace.id, site.id, current, { limit: 100 });
  const timeSeriesRequest = buildMetricRequest(workspace.id, site.id, current, {
    ...(filters ? { filters } : {}),
    granularity: range === "24h" ? "hour" : "day",
  });

  const [
    currentMetrics,
    previousMetrics,
    topPages,
    topReferrers,
    vitals,
    timeSeries,
    journeys,
    countries,
    devices,
    activeVisitors,
  ] = await Promise.all([
    getOverviewMetrics(currentRequest),
    getOverviewMetrics(previousRequest),
    getBreakdown(currentRequest, "path"),
    getBreakdown(currentRequest, "referrer"),
    getWebVitalsSummary(currentRequest),
    getTimeSeries(timeSeriesRequest),
    getTopJourneys(currentRequest),
    getBreakdown(filterCatalogRequest, "country"),
    getBreakdown(filterCatalogRequest, "device"),
    getActiveVisitorCount(site.id),
  ]);

  const pagesPerSession =
    currentMetrics.sessions > 0 ? currentMetrics.pageviews / currentMetrics.sessions : 0;
  const prevPagesPerSession =
    previousMetrics.sessions > 0 ? previousMetrics.pageviews / previousMetrics.sessions : 0;

  const visitorSpark = timeSeries.map((p) => p.visitors);
  const sessionSpark = timeSeries.map((p) => p.sessions);
  const pageviewSpark = timeSeries.map((p) => p.pageviews);
  const ppsSpark = timeSeries.map((p) => (p.sessions > 0 ? p.pageviews / p.sessions : 0));

  return (
    <div className="w-full space-y-5 text-left">
      {/* Page Header: Strictly Anchored to Top-Left */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
        <div className="text-left">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-zinc-50">Overview</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              Cookieless
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Privacy-first analytics &amp; performance metrics for{" "}
            <span className="font-mono font-medium text-zinc-300">{site.domain}</span>
          </p>
        </div>

        {/* Top-Right Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <AnalyticsFilterBar
            range={range}
            countries={countries.items
              .filter((item) => /^[A-Z]{2}$/.test(item.name))
              .map((item) => ({ code: item.name, visitors: item.visitors }))}
            devices={devices.items
              .map((item) => item.name)
              .filter((item) => ["desktop", "mobile", "tablet"].includes(item))}
            {...(country ? { country } : {})}
            {...(device ? { device } : {})}
          />
          <Badge variant="live" className="h-8 rounded-lg px-2.5 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-live" />
            <span className="font-semibold tabular-nums text-emerald-300">
              {formatNumber(activeVisitors)} active
            </span>
          </Badge>
        </div>
      </div>

      {/* KPI Cards Grid: All Headings in Upper-Left Corner */}
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
        <StatsCard
          title="Unique Visitors"
          value={formatNumber(currentMetrics.visitors)}
          change={formatChange(percentChange(currentMetrics.visitors, previousMetrics.visitors))}
          isPositive={currentMetrics.visitors >= previousMetrics.visitors}
          sparkline={visitorSpark}
          sparklineVariant="bar"
          sparklineColor="#3b82f6"
        />
        <StatsCard
          title="Total Sessions"
          value={formatNumber(currentMetrics.sessions)}
          change={formatChange(percentChange(currentMetrics.sessions, previousMetrics.sessions))}
          isPositive={currentMetrics.sessions >= previousMetrics.sessions}
          sparkline={sessionSpark}
          sparklineVariant="bar"
          sparklineColor="#a855f7"
        />
        <StatsCard
          title="Pageviews"
          value={formatNumber(currentMetrics.pageviews)}
          change={formatChange(percentChange(currentMetrics.pageviews, previousMetrics.pageviews))}
          isPositive={currentMetrics.pageviews >= previousMetrics.pageviews}
          sparkline={pageviewSpark}
          sparklineVariant="bar"
          sparklineColor="#22c55e"
        />
        <StatsCard
          title="Pages / Session"
          value={pagesPerSession > 0 ? pagesPerSession.toFixed(1) : "–"}
          change={formatChange(percentChange(pagesPerSession, prevPagesPerSession))}
          isPositive={pagesPerSession >= prevPagesPerSession}
          sparkline={ppsSpark}
          sparklineVariant="bar"
          sparklineColor="#f59e0b"
        />
        <StatsCard
          title="Bounce Rate"
          value={formatPercent(currentMetrics.bounceRatePercentage)}
          change={formatChange(
            percentChange(currentMetrics.bounceRatePercentage, previousMetrics.bounceRatePercentage),
          )}
          isPositive={currentMetrics.bounceRatePercentage <= previousMetrics.bounceRatePercentage}
          sparkline={sessionSpark}
          sparklineVariant="bar"
          sparklineColor="#ef4444"
        />
        <StatsCard
          title="Session Duration"
          value={formatDuration(currentMetrics.avgDurationSeconds)}
          change={formatChange(
            percentChange(currentMetrics.avgDurationSeconds, previousMetrics.avgDurationSeconds),
          )}
          isPositive={currentMetrics.avgDurationSeconds >= previousMetrics.avgDurationSeconds}
          sparkline={visitorSpark}
          sparklineVariant="bar"
          sparklineColor="#06b6d4"
        />
        <Card className="p-0">
          <VitalsPulse
            vitals={vitals}
            href={`/${workspace.slug}/sites/${site.domain}/vitals?range=${range}`}
          />
        </Card>
        <StatsCard
          title="Live Concurrent"
          value={formatNumber(activeVisitors)}
          subtitle="Realtime visitors on site"
          sparkline={visitorSpark.slice(-12)}
          sparklineVariant="bar"
          sparklineColor="#22c55e"
        />
      </div>

      {/* Traffic Overview Time-Series Card: Upper-Left Header */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
          <div>
            <CardTitle>Traffic Overview</CardTitle>
            <CardDescription>
              Volume and trend analysis of unique visitors &amp; sessions over {range}
            </CardDescription>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {range}
          </span>
        </CardHeader>
        <div className="pt-2">
          <TimeSeriesChart points={timeSeries} primary="visitors" secondary="sessions" />
        </div>
      </Card>

      {/* 2-Column Split: Top Sources & Top Pages */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top Traffic Sources</CardTitle>
              <CardDescription>Acquisition breakdown by referrer domain</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Visitors · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topReferrers.items.map((item) => ({
                name: item.name || "Direct / None",
                value: item.visitors,
                percentage: item.percentage,
                icon: <Globe2 className="h-3.5 w-3.5" />,
              }))}
              empty="No acquisition data in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top Visited Pages</CardTitle>
              <CardDescription>Most frequented routes by pageview volume</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Pageviews · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topPages.items.map((item) => ({
                name: item.name,
                value: item.pageviews,
                percentage: item.percentage,
                icon: <FileText className="h-3.5 w-3.5" />,
              }))}
              empty="No pageviews recorded in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
      </div>

      {/* Top User Journeys Card: Left-Anchored Header with Breadcrumb Path Badges */}
      {journeys.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>
                <Compass className="h-4 w-4 text-blue-400" />
                Top User Journeys
              </CardTitle>
              <CardDescription>
                Most frequent sequential page paths within individual privacy-safe sessions
              </CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Sessions · Visitors
            </span>
          </CardHeader>
          <div className="space-y-1 pt-2">
            {journeys.slice(0, 5).map((journey, index) => {
              const steps = journey.journey.split(" → ");
              return (
                <div
                  key={journey.journey}
                  className="group relative flex flex-col gap-2 rounded-lg px-3 py-2.5 transition-all duration-150 hover:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between text-left"
                >
                  {/* Left: Rank & Styled Path Badges */}
                  <div className="flex items-center gap-3 min-w-0 flex-wrap">
                    <span className="shrink-0 w-5 text-right font-mono text-[11px] font-semibold text-zinc-500 tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      {steps.map((step, sIdx) => (
                        <div key={sIdx} className="flex items-center gap-1.5">
                          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-zinc-200 transition group-hover:border-white/[0.14] group-hover:text-white">
                            {step}
                          </span>
                          {sIdx < steps.length - 1 && (
                            <span className="text-zinc-600 text-xs select-none">→</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: Metrics */}
                  <div className="shrink-0 flex items-center gap-3 pl-8 sm:pl-0 font-mono text-[11px]">
                    <span className="text-zinc-400">
                      <strong className="text-zinc-200 font-semibold">{formatNumber(journey.sessions)}</strong> sess
                    </span>
                    <span className="h-3 w-px bg-white/[0.1]" />
                    <span className="text-zinc-400">
                      <strong className="text-zinc-200 font-semibold">{formatNumber(journey.visitors)}</strong> visitors
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Compliance / Architecture Callout: Strictly Left-Anchored */}
      <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-zinc-400 text-left">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <div className="space-y-1">
          <p className="font-medium text-zinc-300">
            Cryptographic Privacy &amp; Period Uniques Engine
          </p>
          <p className="text-zinc-400 leading-relaxed">
            Period uniques are calculated using ClickHouse{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-blue-300">
              uniqExact()
            </code>{" "}
            hyper-accurate sketches across the full timeframe rather than summations of daily counts. IP addresses are discarded at the edge after rotating daily salt hashing.
          </p>
        </div>
      </div>
    </div>
  );
}
