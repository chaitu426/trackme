import { cachedBreakdown, cachedOverview, cachedTimeSeries, cachedWebVitals } from "@/lib/cached-analytics";
import { StatsCard } from "@/components/ui/stats-card";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { DevicesCard } from "@/components/overview-insights";
import { GeoGlobe } from "@/components/geo-globe";
import { buildMetricRequest } from "@/lib/metrics";
import { resolveDateRange, percentChange, type RangeKey } from "@/lib/date-range";
import { fillTimeSeries } from "@/lib/time-series-fill";
import { sourceLabel } from "@/lib/channels";
import { countryName } from "@/lib/countries";
import { getActiveVisitorCount } from "@/lib/realtime";
import { formatNumber, formatPercent, formatChange, formatDuration } from "@/lib/format";

export interface ShareProps {
  workspaceId: string;
  siteId: string;
  range: RangeKey;
}

const COMPARE: Record<RangeKey, string> = {
  "24h": "vs previous 24 hours",
  "7d": "vs previous 7 days",
  "30d": "vs previous 30 days",
};
const PHRASE: Record<RangeKey, string> = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };

function requests({ workspaceId, siteId, range }: ShareProps) {
  const { current, previous } = resolveDateRange(range);
  return {
    current: buildMetricRequest(workspaceId, siteId, current, { limit: 8 }),
    previous: buildMetricRequest(workspaceId, siteId, previous, { limit: 8 }),
    catalog: buildMetricRequest(workspaceId, siteId, current, { limit: 100 }),
    series: buildMetricRequest(workspaceId, siteId, current, { granularity: range === "24h" ? "hour" : "day" }),
  };
}

export async function OnlineNow({ siteId }: { siteId: string }) {
  const active = await getActiveVisitorCount(siteId);
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-raised px-3 text-xs text-zinc-200">
      <span className="h-1.5 w-1.5 rounded-full bg-[#4cc38a] pulse-live" />
      <span className="font-mono tabular-nums">{formatNumber(active)}</span>
      <span className="text-zinc-400">online now</span>
    </span>
  );
}

export async function ShareKpis(props: ShareProps) {
  const r = requests(props);
  const [now, before] = await Promise.all([cachedOverview(r.current), cachedOverview(r.previous)]);
  const compareTo = COMPARE[props.range];
  return (
    <div className="reveal grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatsCard
        title={props.range === "24h" ? "Visitors" : "Visitors (daily unique)"}
        value={formatNumber(now.visitors)}
        change={formatChange(percentChange(now.visitors, before.visitors))}
        isPositive={now.visitors >= before.visitors}
        compareTo={compareTo}
      />
      <StatsCard
        title="Sessions"
        value={formatNumber(now.sessions)}
        change={formatChange(percentChange(now.sessions, before.sessions))}
        isPositive={now.sessions >= before.sessions}
        compareTo={compareTo}
      />
      <StatsCard
        title="Pageviews"
        value={formatNumber(now.pageviews)}
        change={formatChange(percentChange(now.pageviews, before.pageviews))}
        isPositive={now.pageviews >= before.pageviews}
        compareTo={compareTo}
      />
      <StatsCard
        title="Bounce rate"
        value={formatPercent(now.bounceRatePercentage)}
        change={formatChange(percentChange(now.bounceRatePercentage, before.bounceRatePercentage))}
        isPositive={now.bounceRatePercentage <= before.bounceRatePercentage}
        compareTo={compareTo}
      />
    </div>
  );
}

export async function ShareTraffic(props: ShareProps) {
  const r = requests(props);
  const raw = await cachedTimeSeries(r.series);
  const points = fillTimeSeries(raw, resolveDateRange(props.range).current, props.range === "24h" ? "hour" : "day");
  return (
    <Card className="reveal overflow-hidden px-0 pb-4">
      <CardHeader className="px-5 pb-2">
        <CardTitle>Traffic</CardTitle>
        <CardDescription>Visitors and sessions over the {PHRASE[props.range]}</CardDescription>
      </CardHeader>
      <TimeSeriesChart points={points} primary="visitors" secondary="sessions" />
    </Card>
  );
}

function Cell({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-4 p-5">
      <span className="text-sm text-zinc-400">{title}</span>
      <p className="text-[28px] font-medium leading-8 text-zinc-50 tabular-nums">{value}</p>
      <p className="text-xs leading-4 text-zinc-500">{note}</p>
    </div>
  );
}

/** Depth of the visit and how the site felt, in one quiet strip. */
export async function ShareStrip(props: ShareProps) {
  const r = requests(props);
  const [now, vitals] = await Promise.all([cachedOverview(r.current), cachedWebVitals(r.current)]);
  const pagesPerSession = now.sessions > 0 ? now.pageviews / now.sessions : 0;
  const samples = vitals.reduce((total, v) => total + v.totalSamples, 0);
  const good = vitals.reduce((total, v) => total + v.goodCount, 0);
  const score = samples > 0 ? Math.round((good / samples) * 100) : null;

  return (
    <Card className="reveal grid grid-cols-2 divide-white/[0.08] overflow-hidden lg:grid-cols-3 lg:divide-x">
      <Cell title="Pages per session" value={pagesPerSession > 0 ? pagesPerSession.toFixed(1) : "–"} note="Pages a visitor views in one visit" />
      <Cell title="Session duration" value={formatDuration(now.avgDurationSeconds)} note="Average time actively on the site" />
      <Cell
        title="Web Vitals"
        value={score === null ? "–" : `${score}%`}
        note={score === null ? "No samples yet" : `of ${formatNumber(samples)} real visits rated good`}
      />
    </Card>
  );
}

export async function ShareTopPages(props: ShareProps) {
  const [pages, totals] = await Promise.all([
    cachedBreakdown(requests(props).current, "path"),
    cachedOverview(requests(props).current),
  ]);
  const totalPageviews = Math.max(totals.pageviews, 1);
  return (
    <Card className="reveal">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Top pages</CardTitle>
          <CardDescription>Most viewed routes</CardDescription>
        </div>
        <span className="font-mono text-xs text-zinc-500">Pageviews · share</span>
      </CardHeader>
      <RankingList
        items={pages.items.map((item) => ({
          name: item.name,
          value: item.pageviews,
          percentage: Math.min(100, (item.pageviews / totalPageviews) * 100),
        }))}
        empty="No pageviews in this range yet."
        valueFormatter={formatNumber}
        pageSize={8}
      />
    </Card>
  );
}

export async function ShareTopSources(props: ShareProps) {
  const referrers = await cachedBreakdown(requests(props).current, "referrer");
  return (
    <Card className="reveal">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Top sources</CardTitle>
          <CardDescription>Where visitors come from</CardDescription>
        </div>
        <span className="font-mono text-xs text-zinc-500">Visitors · share</span>
      </CardHeader>
      <RankingList
        items={referrers.items.map((item) => ({ name: sourceLabel(item.name), value: item.visitors, percentage: item.percentage }))}
        empty="No referrers in this range yet."
        valueFormatter={formatNumber}
        pageSize={8}
      />
    </Card>
  );
}

export async function ShareLocations(props: ShareProps) {
  const countries = await cachedBreakdown(requests(props).catalog, "country");
  const located = countries.items.filter((c) => /^[A-Z]{2}$/.test(c.name));
  return (
    <div className="reveal grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>{formatNumber(located.length)} countries with visitors</CardDescription>
        </CardHeader>
        <GeoGlobe
          countries={located.map((c) => ({ name: c.name, visitors: c.visitors, percentage: c.percentage }))}
          range={props.range}
          height={380}
        />
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Countries</CardTitle>
            <CardDescription>Ranked by visitors</CardDescription>
          </div>
          <span className="font-mono text-xs text-zinc-500">Visitors · share</span>
        </CardHeader>
        <RankingList
          items={located.map((c) => ({ name: countryName(c.name), value: c.visitors, percentage: c.percentage }))}
          empty="No location data in this range yet."
          valueFormatter={formatNumber}
          pageSize={8}
        />
      </Card>
    </div>
  );
}

export async function ShareDevices(props: ShareProps) {
  const { current } = requests(props);
  const [devices, browsers, systems] = await Promise.all([
    cachedBreakdown(current, "device"),
    cachedBreakdown(current, "browser"),
    cachedBreakdown(current, "os"),
  ]);
  return <DevicesCard devices={devices.items} browsers={browsers.items} systems={systems.items} />;
}
