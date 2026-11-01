import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  cachedBreakdown,
  cachedJourneyGraph,
  cachedOverview,
  cachedTimeSeries,
  cachedWebVitals,
} from "@/lib/cached-analytics";
import { StatsCard } from "@/components/ui/stats-card";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { AnalyticsFilterBar } from "@/components/analytics-filter-bar";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { VitalsPulse } from "@/components/vitals-pulse";
import { JourneySankey } from "@/components/journey-sankey";
import { DevicesCard, LocationsCard } from "@/components/overview-insights";
import { getActiveVisitorCount } from "@/lib/realtime";
import { buildMetricRequest } from "@/lib/metrics";
import { resolveDateRange, percentChange, type RangeKey } from "@/lib/date-range";
import { fillTimeSeries } from "@/lib/time-series-fill";
import { sourceLabel } from "@/lib/channels";
import { formatNumber, formatPercent, formatChange, formatDuration } from "@/lib/format";
import type { DimensionFilter } from "@trackme/contracts";

/**
 * Each section below fetches only what it renders and sits in its own <Suspense> in
 * page.tsx, so the shell paints at once and cards fill in as their queries finish.
 * Identical calls across sections (e.g. the time series) share one ClickHouse query
 * through the single-flight in query-cache.
 */
export interface SectionProps {
  workspaceId: string;
  workspaceSlug: string;
  siteId: string;
  domain: string;
  range: RangeKey;
  filters?: DimensionFilter | undefined;
}

function requests({ workspaceId, siteId, range, filters }: SectionProps) {
  const { current, previous } = resolveDateRange(range);
  const extra = filters ? { filters } : {};
  return {
    current: buildMetricRequest(workspaceId, siteId, current, { limit: 10, ...extra }),
    previous: buildMetricRequest(workspaceId, siteId, previous, { limit: 10, ...extra }),
    catalog: buildMetricRequest(workspaceId, siteId, current, { limit: 100 }),
    series: buildMetricRequest(workspaceId, siteId, current, {
      ...extra,
      granularity: range === "24h" ? "hour" : "day",
    }),
  };
}

async function loadSeries(props: SectionProps) {
  const raw = await cachedTimeSeries(requests(props).series);
  return fillTimeSeries(raw, resolveDateRange(props.range).current, props.range === "24h" ? "hour" : "day");
}

export async function OverviewFilterBar(props: SectionProps) {
  const r = requests(props);
  const [countries, devices] = await Promise.all([
    cachedBreakdown(r.catalog, "country"),
    cachedBreakdown(r.catalog, "device"),
  ]);
  const country = props.filters?.country;
  const device = props.filters?.device;
  return (
    <AnalyticsFilterBar
      range={props.range}
      countries={countries.items
        .filter((item) => /^[A-Z]{2}$/.test(item.name))
        .map((item) => ({ code: item.name, visitors: item.visitors }))}
      devices={devices.items
        .map((item) => item.name)
        .filter((item) => ["desktop", "mobile", "tablet"].includes(item))}
      {...(country ? { country } : {})}
      {...(device ? { device } : {})}
    />
  );
}

export async function ActiveVisitorsBadge({ siteId }: { siteId: string }) {
  const activeVisitors = await getActiveVisitorCount(siteId);
  return (
    <span className="reveal inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-raised px-3 text-xs text-zinc-200">
      <span className="h-1.5 w-1.5 rounded-full bg-[#4cc38a] pulse-live" />
      <span className="font-mono tabular-nums">{formatNumber(activeVisitors)}</span>
      <span className="text-zinc-400">online now</span>
    </span>
  );
}

const compareLabel = (range: RangeKey) =>
  range === "24h" ? "vs previous 24 hours" : range === "7d" ? "vs previous 7 days" : "vs previous 30 days";

/** The four numbers that answer "how is the site doing", before any chart. */
export async function KpiGrid(props: SectionProps) {
  const r = requests(props);
  const [currentMetrics, previousMetrics] = await Promise.all([cachedOverview(r.current), cachedOverview(r.previous)]);
  const compareTo = compareLabel(props.range);

  return (
    <div className="reveal grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatsCard
        title="Visitors"
        value={formatNumber(currentMetrics.visitors)}
        change={formatChange(percentChange(currentMetrics.visitors, previousMetrics.visitors))}
        isPositive={currentMetrics.visitors >= previousMetrics.visitors}
        compareTo={compareTo}
        numericValue={currentMetrics.visitors}
        valueFormat="number"
      />
      <StatsCard
        title="Sessions"
        value={formatNumber(currentMetrics.sessions)}
        change={formatChange(percentChange(currentMetrics.sessions, previousMetrics.sessions))}
        isPositive={currentMetrics.sessions >= previousMetrics.sessions}
        compareTo={compareTo}
        numericValue={currentMetrics.sessions}
        valueFormat="number"
      />
      <StatsCard
        title="Pageviews"
        value={formatNumber(currentMetrics.pageviews)}
        change={formatChange(percentChange(currentMetrics.pageviews, previousMetrics.pageviews))}
        isPositive={currentMetrics.pageviews >= previousMetrics.pageviews}
        compareTo={compareTo}
        numericValue={currentMetrics.pageviews}
        valueFormat="number"
      />
      <StatsCard
        title="Bounce rate"
        value={formatPercent(currentMetrics.bounceRatePercentage)}
        change={formatChange(percentChange(currentMetrics.bounceRatePercentage, previousMetrics.bounceRatePercentage))}
        isPositive={currentMetrics.bounceRatePercentage <= previousMetrics.bounceRatePercentage}
        compareTo={compareTo}
        numericValue={currentMetrics.bounceRatePercentage}
        valueFormat="percent"
      />
    </div>
  );
}

function MetricCell({
  title,
  value,
  change,
  isPositive,
  note,
  compareTo,
}: {
  title: string;
  value: string;
  change?: string | undefined;
  isPositive?: boolean;
  note?: string;
  compareTo?: string;
}) {
  return (
    <div className="flex flex-col gap-4 p-5">
      <span className="text-sm text-zinc-400">{title}</span>
      <p className="text-[28px] font-medium leading-8 text-zinc-50 tabular-nums">{value}</p>
      <p className="text-xs leading-4 text-zinc-500">
        {change ? (
          <>
            <span className={`font-mono tabular-nums ${isPositive ? "text-[#4cc38a]" : "text-[#e5484d]"}`}>{change}</span>{" "}
            {compareTo}
          </>
        ) : (
          note
        )}
      </p>
    </div>
  );
}

/** The remaining metrics in one quiet strip, so they read as a different kind of thing from the headline four. */
export async function SecondaryMetrics(props: SectionProps) {
  const r = requests(props);
  const [currentMetrics, previousMetrics, vitals, activeVisitors] = await Promise.all([
    cachedOverview(r.current),
    cachedOverview(r.previous),
    cachedWebVitals(r.current),
    getActiveVisitorCount(props.siteId),
  ]);
  const compareTo = compareLabel(props.range);
  const pagesPerSession = currentMetrics.sessions > 0 ? currentMetrics.pageviews / currentMetrics.sessions : 0;
  const prevPagesPerSession = previousMetrics.sessions > 0 ? previousMetrics.pageviews / previousMetrics.sessions : 0;

  return (
    <Card className="reveal grid grid-cols-2 divide-border overflow-hidden p-0 lg:grid-cols-4 lg:divide-x">
      <MetricCell
        title="Pages per session"
        value={pagesPerSession > 0 ? pagesPerSession.toFixed(1) : "–"}
        change={formatChange(percentChange(pagesPerSession, prevPagesPerSession))}
        isPositive={pagesPerSession >= prevPagesPerSession}
        compareTo={compareTo}
        note="Builds up as visitors browse"
      />
      <MetricCell
        title="Session duration"
        value={formatDuration(currentMetrics.avgDurationSeconds)}
        change={formatChange(percentChange(currentMetrics.avgDurationSeconds, previousMetrics.avgDurationSeconds))}
        isPositive={currentMetrics.avgDurationSeconds >= previousMetrics.avgDurationSeconds}
        compareTo={compareTo}
        note="Average active time"
      />
      <VitalsPulse vitals={vitals} href={`/${props.workspaceSlug}/sites/${props.domain}/vitals?range=${props.range}`} />
      <MetricCell title="Online now" value={formatNumber(activeVisitors)} note="Visitors in the last 5 minutes" />
    </Card>
  );
}

const RANGE_PHRASE: Record<RangeKey, string> = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };

export async function TrafficChart(props: SectionProps) {
  const timeSeries = await loadSeries(props);
  const { range } = props;
  return (
    <Card className="reveal overflow-hidden px-0 pb-4">
      <CardHeader className="px-5 pb-2">
        <CardTitle>Traffic</CardTitle>
        <CardDescription>Visitors and sessions over the {RANGE_PHRASE[range]}</CardDescription>
      </CardHeader>
      <TimeSeriesChart points={timeSeries} primary="visitors" secondary="sessions" />
    </Card>
  );
}

export async function TopSources(props: SectionProps) {
  const topReferrers = await cachedBreakdown(requests(props).current, "referrer");
  return (
        <Card className="reveal">
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top sources</CardTitle>
              <CardDescription>Where visitors come from</CardDescription>
            </div>
            <span className="font-mono text-xs text-zinc-500">Visitors · share</span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topReferrers.items.map((item) => ({
                name: sourceLabel(item.name),
                value: item.visitors,
                percentage: item.percentage,
              }))}
              empty="No acquisition data in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
  );
}

export async function TopPages(props: SectionProps) {
  const topPages = await cachedBreakdown(requests(props).current, "path");
  return (
        <Card className="reveal">
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top pages</CardTitle>
              <CardDescription>Most viewed routes</CardDescription>
            </div>
            <span className="font-mono text-xs text-zinc-500">Pageviews · share</span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topPages.items.map((item) => ({
                name: item.name,
                value: item.pageviews,
                percentage: item.percentage,
              }))}
              empty="No pageviews recorded in this range yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
  );
}

export async function LocationsSection(props: SectionProps) {
  // The globe shows every market, so this ignores the country filter.
  const countries = await cachedBreakdown(requests(props).catalog, "country");
  return (
    <LocationsCard
      countries={countries.items}
      range={props.range}
      href={`/${props.workspaceSlug}/sites/${props.domain}/geography?range=${props.range}`}
    />
  );
}

export async function DevicesSection(props: SectionProps) {
  const { current } = requests(props);
  const [devices, browsers, systems] = await Promise.all([
    cachedBreakdown(current, "device"),
    cachedBreakdown(current, "browser"),
    cachedBreakdown(current, "os"),
  ]);
  return <DevicesCard devices={devices.items} browsers={browsers.items} systems={systems.items} />;
}

export async function TopJourneys(props: SectionProps) {
  const graph = await cachedJourneyGraph(requests(props).current);
  // Needs at least a second column to draw a flow.
  if (graph.steps < 2 || graph.totalSessions === 0) return null;

  // Sessions that ended on their first page are the "left the site" node in column two.
  const single = graph.nodes.find((n) => n.step === 2 && n.page === "__exit__")?.sessions ?? 0;
  const multiPct = Math.round(((graph.totalSessions - single) / graph.totalSessions) * 100);
  const href = `/${props.workspaceSlug}/sites/${props.domain}/journeys?range=${props.range}`;

  return (
    <Card className="reveal overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>
            Top journeys
          </CardTitle>
          <CardDescription>The full visitor flow, from entry page to the last step. Click to open every detail</CardDescription>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          Open journeys <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <div className="pt-3">
        <JourneySankey graph={graph} href={href} />
      </div>
      <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">
        <span className="font-medium text-zinc-300">{multiPct}%</span> of sessions visit more than one page. Hover a page to follow it, or click the flow to open routes, segments and drop-offs.
      </p>
    </Card>
  );
}
