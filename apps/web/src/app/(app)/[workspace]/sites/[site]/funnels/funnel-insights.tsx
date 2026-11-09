"use client";

import { PillTabs } from "@/components/motion/primitives";
import { NativeSelect } from "@/components/ui/field";
import * as React from "react";
import { Clock, Layers, SlidersHorizontal } from "lucide-react";
import type { FunnelAnalysisResult, FunnelInsights, FunnelSegment } from "@trackme/analytics";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FlagImage } from "@/components/ui/flag-image";
import { Skeleton } from "@/components/ui/skeleton";
import { countryName } from "@/lib/countries";

const SEGMENTS: { key: FunnelSegment; label: string }[] = [
  { key: "device", label: "Device" },
  { key: "country", label: "Country" },
  { key: "source", label: "Source" },
  { key: "browser", label: "Browser" },
  { key: "os", label: "OS" },
];

function seconds(value: number): string {
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * Three reads on one funnel that the step bars can't show: which segment leaks where, how
 * long each step takes, and what fixing a step would be worth. The first two load from the
 * insights endpoint (cached per segment); the third is arithmetic on the analysis.
 */
export function FunnelInsightsPanel({
  siteId,
  funnelId,
  analysis,
  days,
}: {
  siteId: string;
  funnelId: string;
  analysis: FunnelAnalysisResult;
  days: number;
}) {
  const [segment, setSegment] = React.useState<FunnelSegment>("device");
  const [data, setData] = React.useState<FunnelInsights | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const cache = React.useRef(new Map<string, FunnelInsights>());

  React.useEffect(() => {
    const key = `${funnelId}:${segment}:${days}`;
    const hit = cache.current.get(key);
    if (hit) {
      setData(hit);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch(`/api/v1/sites/${siteId}/funnels/${funnelId}/insights?segment=${segment}&days=${days}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as FunnelInsights;
        cache.current.set(key, body);
        setData(body);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("funnel insights", err);
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [siteId, funnelId, segment, days]);

  return (
    <div className="space-y-5">
      <SegmentBreakdown
        analysis={analysis}
        segment={segment}
        onSegment={setSegment}
        data={data}
        loading={loading}
        error={error}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <TimeBetweenSteps analysis={analysis} data={data} loading={loading} error={error} />
        <WhatIf analysis={analysis} />
      </div>
    </div>
  );
}

/* ───────────────────────────── Segment breakdown ───────────────────────────── */

function segmentLabel(segment: FunnelSegment, value: string): React.ReactNode {
  if (segment === "country" && /^[A-Z]{2}$/.test(value)) {
    return (
      <span className="flex items-center gap-2">
        <FlagImage code={value} size={16} />
        {countryName(value)}
      </span>
    );
  }
  return <span className="capitalize">{value}</span>;
}

function SegmentBreakdown({
  analysis,
  segment,
  onSegment,
  data,
  loading,
  error,
}: {
  analysis: FunnelAnalysisResult;
  segment: FunnelSegment;
  onSegment: (s: FunnelSegment) => void;
  data: FunnelInsights | null;
  loading: boolean;
  error: boolean;
}) {
  const steps = analysis.steps;
  const overall = steps.map((s) => s.conversions);
  const rows = data?.segments ?? [];
  const finalRates = rows.map((r) => pct(r.reached[r.reached.length - 1] ?? 0, r.started));
  const weakest = rows.length > 1 ? finalRates.indexOf(Math.min(...finalRates)) : -1;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div>
          <CardTitle>
            <Layers className="h-4 w-4 text-zinc-200" />
            Where each segment leaves
          </CardTitle>
          <CardDescription>Share of each group that reaches every step. Red is below the funnel average.</CardDescription>
        </div>
        <PillTabs kind="radio" size="sm" label="Segment" value={segment} onChange={onSegment} items={SEGMENTS.map((s) => ({ id: s.key, label: s.label }))} />
      </CardHeader>

      {loading ? (
        <div role="status" aria-busy="true" className="space-y-2 p-4">
          <span className="sr-only">Loading segment breakdown</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <p className="py-10 text-center text-xs text-[#e5484d]">The breakdown could not be loaded. Try another tab or refresh.</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-xs text-zinc-500">No sessions entered this funnel in the period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-4 py-3 text-xs font-medium text-zinc-500">
                  {SEGMENTS.find((s) => s.key === segment)?.label}
                </th>
                {steps.map((s) => (
                  <th key={s.order} className="px-3 py-3 text-xs font-medium text-zinc-400">
                    <span className="mr-2 font-mono text-zinc-600">{s.order}</span>
                    {s.name}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500">Converted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const final = finalRates[ri] ?? 0;
                return (
                  <tr key={row.segment}>
                    <th className="sticky left-0 z-10 border-t border-white/[0.06] bg-card px-4 py-3 text-xs font-medium text-zinc-200">
                      {segmentLabel(segment, row.segment)}
                      <span className="mt-0.5 block font-mono text-xs font-normal text-zinc-600">
                        {row.started.toLocaleString()} entered
                      </span>
                    </th>
                    {steps.map((step, i) => {
                      const reached = row.reached[i] ?? 0;
                      const share = pct(reached, row.started);
                      const avg = pct(overall[i] ?? 0, overall[0] ?? 0);
                      const behind = i > 0 && share < avg - 4;
                      return (
                        <td key={step.order} className="border-t border-white/[0.06] px-3 py-3">
                          <p
                            className={`font-mono text-xs font-medium tabular-nums ${
                              i === 0 ? "text-zinc-100" : behind ? "text-[#e5484d]" : share > avg + 4 ? "text-[#4cc38a]" : "text-zinc-100"
                            }`}
                          >
                            {share}%
                          </p>
                          <p className="font-mono text-xs tabular-nums text-zinc-500">{reached.toLocaleString()}</p>
                        </td>
                      );
                    })}
                    <td className="border-t border-white/[0.06] px-4 py-3 text-right">
                      <p className="font-mono text-xs font-medium tabular-nums text-zinc-100">{final}%</p>
                      {ri === weakest && <p className="text-xs font-medium text-[#e5484d]">weakest</p>}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <th className="sticky left-0 z-10 border-t border-white/[0.1] bg-card px-4 py-3 text-xs font-medium text-zinc-400">
                  All sessions
                </th>
                {steps.map((step, i) => (
                  <td key={step.order} className="border-t border-white/[0.1] px-3 py-3">
                    <p className="font-mono text-xs font-medium tabular-nums text-zinc-400">{pct(overall[i] ?? 0, overall[0] ?? 0)}%</p>
                  </td>
                ))}
                <td className="border-t border-white/[0.1] px-4 py-3 text-right font-mono text-xs font-medium tabular-nums text-zinc-400">
                  {analysis.overallConversionRate}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────────── Time between steps ───────────────────────────── */

function TimeBetweenSteps({
  analysis,
  data,
  loading,
  error,
}: {
  analysis: FunnelAnalysisResult;
  data: FunnelInsights | null;
  loading: boolean;
  error: boolean;
}) {
  const name = (order: number) => analysis.steps.find((s) => s.order === order)?.name ?? `Step ${order}`;
  return (
    <Card>
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <CardTitle>
          <Clock className="h-4 w-4 text-zinc-200" />
          Time between steps
        </CardTitle>
        <CardDescription>For sessions that made it through both steps</CardDescription>
      </CardHeader>

      {loading ? (
        <div role="status" aria-busy="true" className="space-y-4 pt-4">
          <span className="sr-only">Loading timings</span>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : error || !data ? (
        <p className="py-10 text-center text-xs text-[#e5484d]">Timings could not be loaded.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {data.timing.map((t) => {
            const peak = Math.max(...t.buckets.map((b) => b.count), 1);
            return (
              <li key={t.fromStep} className="py-4 first:pt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-xs font-medium text-zinc-200">
                    {name(t.fromStep)} <span className="text-zinc-600">→</span> {name(t.toStep)}
                  </p>
                  <p className="shrink-0 text-right">
                    <span className="font-mono text-lg font-medium tabular-nums text-zinc-50">{t.samples > 0 ? seconds(t.medianSeconds) : "–"}</span>
                    <span className="ml-2 text-xs text-zinc-500">median</span>
                  </p>
                </div>
                {t.samples > 0 ? (
                  <>
                    <div className="mt-3 flex h-12 items-end gap-2" role="img" aria-label="Distribution of time between steps">
                      {t.buckets.map((b) => (
                        <div
                          key={b.label}
                          className="group relative flex-1 rounded-t-sm bg-white/[0.07] transition-colors hover:bg-white/[0.07]"
                          style={{ height: `${Math.max((b.count / peak) * 100, b.count > 0 ? 6 : 2)}%`, opacity: b.count > 0 ? 1 : 0.25 }}
                          title={`${b.label}: ${b.count.toLocaleString()} sessions (${pct(b.count, t.samples)}%)`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex gap-2">
                      {t.buckets.map((b) => (
                        <span key={b.label} className="flex-1 text-center font-mono text-xs text-zinc-600">
                          {b.label}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      9 in 10 take under <span className="font-medium text-zinc-300">{seconds(t.p90Seconds)}</span> · {t.samples.toLocaleString()} sessions
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-zinc-600">No session completed both steps in this period.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ───────────────────────────── What if ───────────────────────────── */

function WhatIf({ analysis }: { analysis: FunnelAnalysisResult }) {
  const steps = analysis.steps;
  const transitions = steps.slice(1).map((step, i) => {
    const prev = steps[i]!;
    return { index: i + 1, from: prev, to: step, rate: prev.conversions > 0 ? step.conversions / prev.conversions : 0 };
  });

  // Start on the transition that loses the most people.
  const worst = transitions.reduce<number>(
    (best, t, i) => (t.to.dropOffCount > (transitions[best]?.to.dropOffCount ?? -1) ? i : best),
    0
  );
  const [selected, setSelected] = React.useState(worst);
  const [lift, setLift] = React.useState(10);
  const t = transitions[selected];
  if (!t) return null;

  const entered = steps[0]?.conversions ?? 0;
  const completed = steps[steps.length - 1]?.conversions ?? 0;
  // The step converts better by `lift` percent (relative, capped at 100%), and everyone who
  // gets through goes on to convert at the rates they do today.
  const newRate = Math.min(1, t.rate * (1 + lift / 100));
  const factor = t.rate > 0 ? newRate / t.rate : 1;
  const projected = Math.round(completed * factor);
  const extra = projected - completed;

  return (
    <Card>
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <CardTitle>
          <SlidersHorizontal className="h-4 w-4 text-zinc-200" />
          What if you improved a step
        </CardTitle>
        <CardDescription>A rough sizing of what a fix could be worth</CardDescription>
      </CardHeader>

      <div className="space-y-5 pt-4">
        <div className="space-y-2">
          <label htmlFor="whatif-step" className="text-xs font-medium text-zinc-400">
            Transition
          </label>
          <NativeSelect
            id="whatif-step"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="w-full"
          >
            {transitions.map((tr, i) => (
              <option key={tr.index} value={i}>
                {tr.from.name} → {tr.to.name} ({Math.round(tr.rate * 1000) / 10}% continue)
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="whatif-lift" className="text-xs font-medium text-zinc-400">
              Improve conversion by
            </label>
            <span className="font-mono text-sm font-medium tabular-nums text-zinc-50">{lift}%</span>
          </div>
          <input
            id="whatif-lift"
            type="range"
            min={0}
            max={50}
            step={5}
            value={lift}
            onChange={(e) => setLift(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[0.1]"
          />
          <p className="font-mono text-xs text-zinc-500">
            {Math.round(t.rate * 1000) / 10}% → {Math.round(newRate * 1000) / 10}% of people continue
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-xs text-zinc-500">Projected completions</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-medium tabular-nums text-zinc-50">{projected.toLocaleString()}</span>
            <span className={`font-mono text-xs font-medium tabular-nums ${extra > 0 ? "text-[#4cc38a]" : "text-zinc-500"}`}>
              {extra > 0 ? `+${extra.toLocaleString()}` : "no change"}
            </span>
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            overall {pct(completed, entered)}% → {pct(projected, entered)}% of {entered.toLocaleString()} entrants
          </p>
        </div>

        <p className="text-xs leading-relaxed text-zinc-600">
          Assumes the people who now get through convert at today&apos;s rate on the remaining steps. A planning figure, not a forecast.
        </p>
      </div>
    </Card>
  );
}
