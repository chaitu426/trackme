import Link from "next/link";
import { notFound } from "next/navigation";
import { Info, Gauge } from "lucide-react";
import { getWebVitalsSummary, type WebVitalSummary } from "@trackme/analytics";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { buildMetricRequest } from "@/lib/metrics";
import { RANGE_OPTIONS, parseRangeKey, resolveDateRange } from "@/lib/date-range";

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
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    bar: "bg-emerald-500",
    label: "Good",
  },
  "needs-improvement": {
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    bar: "bg-amber-400",
    label: "Needs Work",
  },
  poor: {
    badge: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    bar: "bg-rose-500",
    label: "Poor",
  },
};

export default async function SiteWebVitalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const { range: rawRange } = await searchParams;
  const range = parseRangeKey(rawRange);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  const { current } = resolveDateRange(range);
  const request = buildMetricRequest(workspace.id, site.id, current);
  const vitalsSummary = await getWebVitalsSummary(request);

  const vitalsMap = new Map<string, WebVitalSummary>();
  for (const v of vitalsSummary) {
    vitalsMap.set(v.metric.toUpperCase(), v);
  }

  const metricKeys = ["LCP", "CLS", "INP", "FCP", "TTFB"];

  return (
    <div className="w-full space-y-5 text-left">
      {/* ── Header: Strictly Left-Anchored ── */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-zinc-50">Core Web Vitals</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400">
              <Gauge className="h-3 w-3" />
              RUM Telemetry
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Real-user 75th-percentile (p75) performance audit for{" "}
            <span className="font-mono font-medium text-zinc-300">{site.domain}</span>
          </p>
        </div>

        <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-xs font-medium text-zinc-400 gap-0.5">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.key}
              href={`?range=${option.key}`}
              className={`rounded-[5px] px-3 py-1.5 transition-colors font-medium ${
                option.key === range
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "hover:bg-white/[0.04] hover:text-zinc-300 text-zinc-500"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── p75 Methodology notice: Left-Anchored ── */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 text-xs text-zinc-300 text-left">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <div className="space-y-1">
          <p className="font-medium text-blue-200">Google p75 Standard Methodology</p>
          <p className="text-zinc-400 leading-relaxed">
            Google Core Web Vitals criteria require 75% of all real-world user page visits to pass the Good threshold. Metrics are sampled continuously via browser PerformanceObserver APIs and stored in ClickHouse.
          </p>
        </div>
      </div>

      {/* ── Vitals Grid: Left-Anchored Card Headers ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                  <p className="font-mono text-[11px] text-zinc-400 pt-1">
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
                    <span className="text-[11px] font-normal text-zinc-400">{config.fullName}</span>
                  </div>
                  <CardDescription className="mt-1">{config.description}</CardDescription>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles.badge}`}
                >
                  {styles.label}
                </span>
              </CardHeader>

              <div className="space-y-4 pt-3 text-xs text-left">
                {/* p75 Metric Value */}
                <div className="flex items-baseline justify-between border-b border-white/[0.06] pb-3">
                  <div>
                    <span className="font-mono text-3xl font-bold tracking-tight text-zinc-50">
                      {config.formatValue(data.p75)}
                    </span>
                    <span className="ml-1.5 font-mono text-[11px] text-zinc-400">p75</span>
                  </div>
                  <span className="font-mono text-[11px] text-zinc-400">
                    {data.totalSamples.toLocaleString()} samples
                  </span>
                </div>

                {/* Distribution bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Performance Distribution</span>
                    <span className="font-semibold text-emerald-400">{goodPct}% Good</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div style={{ width: `${goodPct}%` }} className="bg-emerald-500 h-full transition-all" />
                    <div style={{ width: `${needsPct}%` }} className="bg-amber-400 h-full transition-all" />
                    <div style={{ width: `${poorPct}%` }} className="bg-rose-500 h-full transition-all" />
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-zinc-500">
                    <span>Target: {config.goodThreshold}</span>
                    <span>Poor: {config.poorThreshold}</span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
