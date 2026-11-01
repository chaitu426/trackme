import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { type WebVitalSummary } from "@trackme/analytics";
import { cachedWebVitals } from "@/lib/cached-analytics";
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
    badge: "bg-[#4cc38a]/10 text-[#4cc38a] border-[#4cc38a]/20",
    bar: "bg-[#4cc38a]",
    label: "Good",
  },
  "needs-improvement": {
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    bar: "bg-amber-400",
    label: "Needs Work",
  },
  poor: {
    badge: "bg-[#e5484d]/10 text-[#e5484d] border-[#e5484d]/20",
    bar: "bg-[#e5484d]",
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

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Web Vitals" art="gauge" actions={<RangeSwitcher range={range} />}>
        Real-visitor p75 performance for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      {/* ── p75 Methodology notice: Left-Anchored ── */}
      <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-card p-4 text-xs text-zinc-300 text-left">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <div className="space-y-1">
          <p className="font-medium text-zinc-100">Google p75 methodology</p>
          <p className="text-zinc-400 leading-relaxed">
            Google Core Web Vitals criteria require 75% of all real-world user page visits to pass the Good threshold. Metrics are sampled continuously via browser PerformanceObserver APIs and stored in ClickHouse.
          </p>
        </div>
      </div>

      <Suspense key={range} fallback={<VitalsSkeleton />}>
        <VitalsGrid workspaceId={workspace.id} siteId={site.id} range={range} />
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
                    <span className="font-medium text-[#4cc38a]">{goodPct}% Good</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div style={{ width: `${goodPct}%` }} className="bg-[#4cc38a] h-full transition-colors" />
                    <div style={{ width: `${needsPct}%` }} className="bg-amber-400 h-full transition-colors" />
                    <div style={{ width: `${poorPct}%` }} className="bg-[#e5484d] h-full transition-colors" />
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
