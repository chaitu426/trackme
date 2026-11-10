import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { type WebVitalSummary } from "@trackme/analytics";
import Link from "next/link";
import { cachedVitalsByPage, cachedWebVitals } from "@/lib/cached-analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { parseRangeKey, resolveDateRange, type RangeKey } from "@/lib/date-range";
import { RangeSwitcher } from "@/components/range-switcher";
import { CardHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Card as SkeletonCard } from "@/components/ui/card";

interface MetricConfig {
  name: string;
  fullName: string;
  formatValue: (val: number) => string;
  goodThreshold: string;
  poorThreshold: string;
  description: string;
  getRating: (val: number) => "good" | "needs-improvement" | "poor";
}

const METRIC_CONFIGS: Record<string, MetricConfig> = {
  LCP: {
    name: "LCP",
    fullName: "Largest Contentful Paint",
    formatValue: (val) => (val >= 1000 ? `${(val / 1000).toFixed(2)}s` : `${Math.round(val)}ms`),
    goodThreshold: "≤ 2.5s",
    poorThreshold: "> 4.0s",
    description: "Main content viewport loading performance",
    getRating: (val) => (val <= 2500 ? "good" : val <= 4000 ? "needs-improvement" : "poor"),
  },
  CLS: {
    name: "CLS",
    fullName: "Cumulative Layout Shift",
    formatValue: (val) => val.toFixed(3),
    goodThreshold: "≤ 0.10",
    poorThreshold: "> 0.25",
    description: "Visual stability & unexpected layout shifts",
    getRating: (val) => (val <= 0.1 ? "good" : val <= 0.25 ? "needs-improvement" : "poor"),
  },
  INP: {
    name: "INP",
    fullName: "Interaction to Next Paint",
    formatValue: (val) => `${Math.round(val)}ms`,
    goodThreshold: "≤ 200ms",
    poorThreshold: "> 500ms",
    description: "Responsiveness to user interactions & clicks",
    getRating: (val) => (val <= 200 ? "good" : val <= 500 ? "needs-improvement" : "poor"),
  },
  FCP: {
    name: "FCP",
    fullName: "First Contentful Paint",
    formatValue: (val) => (val >= 1000 ? `${(val / 1000).toFixed(2)}s` : `${Math.round(val)}ms`),
    goodThreshold: "≤ 1.8s",
    poorThreshold: "> 3.0s",
    description: "Time until browser renders first DOM pixel",
    getRating: (val) => (val <= 1800 ? "good" : val <= 3000 ? "needs-improvement" : "poor"),
  },
  TTFB: {
    name: "TTFB",
    fullName: "Time to First Byte",
    formatValue: (val) => `${Math.round(val)}ms`,
    goodThreshold: "≤ 800ms",
    poorThreshold: "> 1800ms",
    description: "Server responsiveness & DNS/TLS latency",
    getRating: (val) => (val <= 800 ? "good" : val <= 1800 ? "needs-improvement" : "poor"),
  },
};

const ratingStyles = {
  good: {
    badge: "bg-good/10 text-good border-good/20",
    bar: "bg-good",
    label: "Good",
  },
  "needs-improvement": {
    badge: "bg-warn/10 text-warn border-warn/20",
    bar: "bg-warn",
    label: "Needs Work",
  },
  poor: {
    badge: "bg-bad/10 text-bad border-bad/20",
    bar: "bg-bad",
    label: "Poor",
  },
};

export default async function SiteWebVitalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<{ range?: string; metric?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const { range: rawRange, metric: rawMetric } = await searchParams;
  const range = parseRangeKey(rawRange);
  const metric = rawMetric && rawMetric.toUpperCase() in METRIC_CONFIGS ? rawMetric.toUpperCase() : "LCP";

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Web Vitals" art="gauge" actions={<RangeSwitcher range={range} extraQuery={`&metric=${metric}`} />}>
        Real-visitor p75 performance for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      {/* ── p75 Methodology notice: Left-Anchored ── */}
      <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-card p-4 text-xs text-zinc-300 text-left">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <div className="space-y-1">
          <p className="font-medium text-zinc-100">Google p75 methodology</p>
          <p className="text-zinc-400 leading-relaxed">
            Google Core Web Vitals criteria require 75% of all real-world user page visits to pass the Good threshold. Metrics are measured in real visitors' browsers, so they reflect actual devices and networks.
          </p>
        </div>
      </div>

      <Suspense key={range} fallback={<VitalsSkeleton />}>
        <VitalsGrid workspaceId={workspace.id} siteId={site.id} range={range} />
      </Suspense>

      <Suspense key={`pages:${range}:${metric}`} fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <PagesNeedingAttention workspaceId={workspace.id} siteId={site.id} range={range} metric={metric} basePath={`/${workspace.slug}/sites/${site.domain}/vitals`} />
      </Suspense>
    </div>
  );
}

function VitalsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 5 }, (_, i) => (
        <SkeletonCard key={i}>
          <CardHeaderSkeleton />
          <div className="space-y-4 pt-3">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

async function VitalsGrid({ workspaceId, siteId, range }: { workspaceId: string; siteId: string; range: RangeKey }) {
  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspaceId, siteId, current);
  const vitalsSummary = await cachedWebVitals(request);

  const vitalsMap = new Map<string, WebVitalSummary>();
  for (const v of vitalsSummary) {
    vitalsMap.set(v.metric.toUpperCase(), v);
  }

  const metricKeys = ["LCP", "CLS", "INP", "FCP", "TTFB"];

  return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 reveal">
        {metricKeys.map((key) => {
          const config = METRIC_CONFIGS[key]!;
          const data = vitalsMap.get(key);

          if (!data || data.totalSamples === 0) {
            return (
              <Card key={key} className="border-dashed border-white/15">
                <CardHeader className="flex-row items-start justify-between border-b border-white/[0.06] pb-3 text-left">
                  <div>
                    <CardTitle>{config.name}</CardTitle>
                    <CardDescription>{config.fullName}</CardDescription>
                  </div>
                  <Badge variant="outline">No Data</Badge>
                </CardHeader>
                <div className="space-y-2 pt-3 text-xs text-zinc-400 text-left">
                  <p>{config.description}</p>
                  <p className="font-mono text-xs text-zinc-400 pt-1">
                    Target: {config.goodThreshold}
                  </p>
                </div>
              </Card>
            );
          }

          const rating = config.getRating(data.p75);
          const styles = ratingStyles[rating];
          const goodPct = Math.round((data.goodCount / data.totalSamples) * 100);
          const needsPct = Math.round((data.needsImprovementCount / data.totalSamples) * 100);
          const poorPct = Math.max(0, 100 - goodPct - needsPct);

          return (
            <Card key={key}>
              <CardHeader className="flex-row items-start justify-between border-b border-white/[0.06] pb-3 text-left">
                <div>
                  <div className="flex items-baseline gap-2">
                    <CardTitle>{config.name}</CardTitle>
                    <span className="text-xs font-normal text-zinc-400">{config.fullName}</span>
                  </div>
                  <CardDescription className="mt-1">{config.description}</CardDescription>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium ${styles.badge}`}
                >
                  {styles.label}
                </span>
              </CardHeader>

              <div className="space-y-4 pt-3 text-xs text-left">
                {/* p75 Metric Value */}
                <div className="flex items-baseline justify-between border-b border-white/[0.06] pb-3">
                  <div>
                    <span className="font-mono text-3xl font-medium text-zinc-50">
                      {config.formatValue(data.p75)}
                    </span>
                    <span className="ml-2 font-mono text-xs text-zinc-400">p75</span>
                  </div>
                  <span className="font-mono text-xs text-zinc-400">
                    {data.totalSamples.toLocaleString()} samples
                  </span>
                </div>

                {/* Distribution bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>Performance Distribution</span>
                    <span className="font-medium text-good">{goodPct}% Good</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div style={{ width: `${goodPct}%` }} className="bg-good h-full transition-colors" />
                    <div style={{ width: `${needsPct}%` }} className="bg-warn h-full transition-colors" />
                    <div style={{ width: `${poorPct}%` }} className="bg-bad h-full transition-colors" />
                  </div>
                  <div className="flex justify-between font-mono text-xs text-zinc-500">
                    <span>Target: {config.goodThreshold}</span>
                    <span>Poor: {config.poorThreshold}</span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
  );
}

const SEVERITY = { poor: 0, "needs-improvement": 1, good: 2 } as const;
const MIN_SAMPLES = 5;

/** The pages dragging a metric down: the answer to "my LCP is bad, but where?" */
async function PagesNeedingAttention({
  workspaceId,
  siteId,
  range,
  metric,
  basePath,
}: {
  workspaceId: string;
  siteId: string;
  range: RangeKey;
  metric: string;
  basePath: string;
}) {
  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspaceId, siteId, current);
  let rows: Awaited<ReturnType<typeof cachedVitalsByPage>> = [];
  let failed = false;
  try {
    rows = await cachedVitalsByPage(request, 500);
  } catch {
    failed = true;
  }

  const config = METRIC_CONFIGS[metric]!;
  const ranked = rows
    .filter((r) => r.metric === metric && r.samples >= MIN_SAMPLES)
    .map((r) => ({ ...r, rating: config.getRating(r.p75) }))
    .sort((a, b) => SEVERITY[a.rating] - SEVERITY[b.rating] || b.p75 - a.p75)
    .slice(0, 10);

  return (
    <Card className="reveal">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-left">
        <div>
          <CardTitle>Pages to fix first</CardTitle>
          <CardDescription>
            Slowest pages for {config.fullName}, worst first. Pages need {MIN_SAMPLES}+ samples to be listed.
          </CardDescription>
        </div>
        <div role="tablist" aria-label="Metric" className="flex items-center gap-0.5 rounded-lg border border-white/[0.08] p-0.5 text-xs">
          {Object.keys(METRIC_CONFIGS).map((key) => (
            <Link
              key={key}
              role="tab"
              aria-selected={key === metric}
              href={`${basePath}?range=${range}&metric=${key}`}
              scroll={false}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                key === metric ? "bg-raised text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {key}
            </Link>
          ))}
        </div>
      </CardHeader>
      {failed ? (
        <p className="py-10 text-center text-xs text-zinc-500">Page-level data is unavailable right now. Try again shortly.</p>
      ) : ranked.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-500">
          Not enough {config.name} samples per page in this range yet.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {ranked.map((r) => (
            <li key={r.path} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0 truncate font-mono text-xs text-zinc-200" title={r.path}>
                {r.path}
              </span>
              <span className="flex shrink-0 items-center gap-3 font-mono text-xs tabular-nums">
                <span className="text-zinc-500">{r.samples.toLocaleString()} samples</span>
                <span className="w-16 text-right text-zinc-100">{config.formatValue(r.p75)}</span>
                <span className={`w-24 rounded-full border px-2 py-0.5 text-center font-sans ${ratingStyles[r.rating].badge}`}>
                  {ratingStyles[r.rating].label}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
