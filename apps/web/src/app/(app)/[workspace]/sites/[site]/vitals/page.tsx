import Link from "next/link";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { getWebVitalsSummary, type WebVitalSummary } from "@trackme/analytics";
import { Card, CardHeader, CardDescription } from "@/components/ui/card";
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
    description: "Main content loading performance",
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
    description: "Responsiveness to user interactions",
    getRating: (val) => (val <= 200 ? "good" : val <= 500 ? "needs-improvement" : "poor"),
  },
  FCP: {
    name: "FCP",
    fullName: "First Contentful Paint",
    formatValue: (val) => (val >= 1000 ? `${(val / 1000).toFixed(2)}s` : `${Math.round(val)}ms`),
    goodThreshold: "≤ 1.8s",
    poorThreshold: "> 3.0s",
    description: "Time until browser renders first DOM content",
    getRating: (val) => (val <= 1800 ? "good" : val <= 3000 ? "needs-improvement" : "poor"),
  },
  TTFB: {
    name: "TTFB",
    fullName: "Time to First Byte",
    formatValue: (val) => `${Math.round(val)}ms`,
    goodThreshold: "≤ 800ms",
    poorThreshold: "> 1800ms",
    description: "Server responsiveness & connection time",
    getRating: (val) => (val <= 800 ? "good" : val <= 1800 ? "needs-improvement" : "poor"),
  },
};

const ratingStyles = {
  good: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    bar: "bg-emerald-500",
    label: "Good",
  },
  "needs-improvement": {
    badge: "bg-amber-50 text-amber-700 border-amber-200/60",
    bar: "bg-amber-500",
    label: "Needs Work",
  },
  poor: {
    badge: "bg-rose-50 text-rose-700 border-rose-200/60",
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
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center space-x-2">
            <span>Core Web Vitals & RUM</span>
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Real user performance percentiles (p75) for{" "}
            <span className="font-mono font-semibold text-zinc-700">{site.domain}</span>
          </p>
        </div>

        {/* Range selector */}
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
      </div>

      {/* ── p75 Methodology notice ── */}
      <div className="flex items-start space-x-3 px-4 py-3 rounded-xl bg-indigo-50/60 border border-indigo-200/50 text-xs text-zinc-600">
        <Info className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
        <div>
          <strong className="text-zinc-800">p75 Methodology:</strong> Google standards require 75% of user visits to meet the Good threshold.
          Measured via real user monitoring (RUM) events batched through ClickHouse.
        </div>
      </div>

      {/* ── Vitals Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {metricKeys.map((key) => {
          const config = METRIC_CONFIGS[key]!;
          const data = vitalsMap.get(key);

          if (!data || data.totalSamples === 0) {
            return (
              <Card key={key} className="border-dashed border-zinc-300/80">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-900">{config.name}</span>
                    <Badge variant="outline">No Data</Badge>
                  </div>
                  <CardDescription>{config.fullName}</CardDescription>
                </CardHeader>
                <div className="space-y-1 text-xs text-zinc-400">
                  <p>{config.description}</p>
                  <p className="font-mono text-[11px] pt-2 text-zinc-300">
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
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline space-x-1.5">
                    <span className="text-sm font-bold text-zinc-900">{config.name}</span>
                    <span className="text-[11px] text-zinc-400 font-normal">{config.fullName}</span>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles.badge}`}
                  >
                    {styles.label}
                  </span>
                </div>
                <CardDescription>{config.description}</CardDescription>
              </CardHeader>

              <div className="space-y-4 text-xs">
                {/* p75 Value */}
                <div className="flex items-baseline justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <span className="text-3xl font-bold text-zinc-900 tracking-tight font-mono">
                      {config.formatValue(data.p75)}
                    </span>
                    <span className="text-[11px] text-zinc-400 ml-1.5 font-mono">p75</span>
                  </div>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    {data.totalSamples.toLocaleString()} samples
                  </span>
                </div>

                {/* Distribution bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Distribution</span>
                    <span className="text-emerald-600 font-semibold">{goodPct}% Good</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full flex overflow-hidden bg-zinc-100">
                    <div style={{ width: `${goodPct}%` }} className="bg-emerald-500 h-full transition-all" />
                    <div style={{ width: `${needsPct}%` }} className="bg-amber-400 h-full transition-all" />
                    <div style={{ width: `${poorPct}%` }} className="bg-rose-500 h-full transition-all" />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400">
                    <span>Good {config.goodThreshold}</span>
                    <span>Poor {config.poorThreshold}</span>
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
