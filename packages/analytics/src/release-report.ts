import { compareLatencies, compareRates, decideVerdict, DEFAULT_RULES, type MetricFinding, type Verdict, type VerdictRules } from "./stats.js";
import type { Dimension, NewIssue, WindowRow } from "./queries/release-impact.js";

/**
 * Turns the raw numbers around a deploy into a report: each metric before and after with its test, a verdict, the
 * reasons, and where the damage is concentrated (browser, country, device). Pure: no I/O, so every rule is testable.
 */

export interface SideInput {
  /** Overall row for the window; null when there was no traffic. */
  total: WindowRow | null;
  /** Rows per dimension value, by dimension. */
  byDimension: Partial<Record<Exclude<Dimension, "total">, WindowRow[]>>;
  lcp: number[];
  inp: number[];
  /** Sessions and how many reached the primary goal; null when the site has no usable goal. */
  conversion: { sessions: number; converted: number } | null;
}

export interface ReportInput {
  release: string;
  previousRelease: string | null;
  deployedAt: string;
  windowHours: number;
  before: SideInput;
  after: SideInput;
  newIssues: NewIssue[];
  /** Resolved issues that came back in this release. */
  regressions: number;
  /** All releases together in the same hours a week earlier, for a seasonality sanity check. */
  baselineWeekAgo?: WindowRow | null;
  goalName?: string | undefined;
  rules?: VerdictRules;
}

export type Unit = "percent" | "per1k" | "ms";

export interface ReportMetric {
  key: string;
  label: string;
  unit: Unit;
  before: number;
  after: number;
  /** Relative change in the direction that is bad (positive = worse); null with no baseline. */
  worseBy: number | null;
  /** null for metrics shown without a test. */
  p: number | null;
  /** Samples or sessions behind the smaller side. */
  n: number;
}

export interface BreakdownRow {
  dimension: string;
  value: string;
  sessionsBefore: number;
  sessionsAfter: number;
  rateBefore: number;
  rateAfter: number;
  ratio: number | null;
  p: number;
}

export interface ReleaseReport {
  release: string;
  previousRelease: string | null;
  deployedAt: string;
  windowHours: number;
  /** False when there is no previous release to compare with; the verdict is then "collecting". */
  comparable: boolean;
  verdict: Verdict;
  /** Plain-language reasons for a Watch or Regressed verdict. */
  reasons: string[];
  sessionsBefore: number;
  sessionsAfter: number;
  metrics: ReportMetric[];
  breakdown: BreakdownRow[];
  newIssues: NewIssue[];
  regressions: number;
  /** Share of sessions with an error in the same hours a week earlier (all releases), and how many sessions that is. */
  baseline: { errorRate: number; sessions: number } | null;
  /**
   * True only for a clear, large regression on real traffic: the verdict is Regressed, the evidence is p < 0.001, and the
   * metric is at least 50% worse. It is a prompt to consider rolling back, never an instruction.
   */
  rollbackSuggested: boolean;
}

/** Smallest group of sessions (each side) worth testing in a breakdown. */
export const MIN_BREAKDOWN_SESSIONS = 100;
/** A group holding more than this share of all sessions says nothing the total does not (a site that is all desktop). */
export const MAX_BREAKDOWN_SHARE = 0.9;

/** Linear-interpolated percentile (0 to 1) of a sample; 0 for an empty one. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (position - lo);
}

const worseBy = (before: number, after: number): number | null => (before > 0 ? (after - before) / before : null);
const per1k = (events: number, sessions: number) => (sessions > 0 ? (events / sessions) * 1000 : 0);
const pct = (value: number) => `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
const pLabel = (p: number) => (p < 0.001 ? "p < 0.001" : p < 0.01 ? "p < 0.01" : `p = ${p.toFixed(2)}`);

export function buildReport(input: ReportInput): ReleaseReport {
  const rules = input.rules ?? DEFAULT_RULES;
  const { before, after } = input;
  const sessionsBefore = before.total?.sessions ?? 0;
  const sessionsAfter = after.total?.sessions ?? 0;
  const metrics: ReportMetric[] = [];
  const findings: MetricFinding[] = [];

  // Sessions with an error: the headline reliability number.
  if (before.total || after.total) {
    const b = before.total ?? { sessions: 0, errorSessions: 0, errors: 0 };
    const a = after.total ?? { sessions: 0, errorSessions: 0, errors: 0 };
    const test = compareRates(b.errorSessions, b.sessions, a.errorSessions, a.sessions);
    const n = Math.min(b.sessions, a.sessions);
    metrics.push({ key: "error_sessions", label: "Sessions with an error", unit: "percent", before: test.before, after: test.after, worseBy: worseBy(test.before, test.after), p: test.p, n });
    findings.push({ metric: "Sessions with an error", worse: test.after > test.before, p: test.p, relativeChange: worseBy(test.before, test.after), n });
    metrics.push({ key: "errors_per_1k", label: "Errors per 1,000 sessions", unit: "per1k", before: per1k(b.errors, b.sessions), after: per1k(a.errors, a.sessions), worseBy: worseBy(per1k(b.errors, b.sessions), per1k(a.errors, a.sessions)), p: null, n });
  }

  // Web vitals: 75th percentile (as Core Web Vitals are judged) with a rank test for whether the distribution moved.
  for (const [key, label, bs, as] of [
    ["lcp", "LCP (75th percentile)", before.lcp, after.lcp],
    ["inp", "INP (75th percentile)", before.inp, after.inp],
  ] as const) {
    if (bs.length === 0 && as.length === 0) continue;
    const test = compareLatencies(bs, as);
    const b75 = percentile(bs, 0.75);
    const a75 = percentile(as, 0.75);
    const n = Math.min(bs.length, as.length);
    metrics.push({ key, label, unit: "ms", before: b75, after: a75, worseBy: worseBy(b75, a75), p: test.p, n });
    // A latency is worse only if its 75th percentile rose AND the whole distribution shifted up.
    findings.push({ metric: label.replace(" (75th percentile)", ""), worse: a75 > b75 && test.z > 0, p: test.p, relativeChange: worseBy(b75, a75), n });
  }

  // Conversion of the primary goal: a DROP is the bad direction.
  if (before.conversion && after.conversion) {
    const b = before.conversion;
    const a = after.conversion;
    const test = compareRates(b.converted, b.sessions, a.converted, a.sessions);
    const drop = test.before > 0 ? (test.before - test.after) / test.before : null;
    const n = Math.min(b.sessions, a.sessions);
    const name = input.goalName ? `Conversion: ${input.goalName}` : "Conversion";
    metrics.push({ key: "conversion", label: name, unit: "percent", before: test.before, after: test.after, worseBy: drop, p: test.p, n });
    findings.push({ metric: name, worse: test.after < test.before, p: test.p, relativeChange: drop, n });
  }

  const comparable = input.previousRelease !== null;
  const decision = comparable ? decideVerdict(sessionsBefore, sessionsAfter, findings, rules) : { verdict: "collecting" as Verdict, reasons: [] };

  // Where the extra error sessions are: groups with enough traffic on both sides whose error rate rose significantly.
  const breakdown: BreakdownRow[] = [];
  for (const dimension of ["browser", "country", "device"] as const) {
    const afterRows = new Map((after.byDimension[dimension] ?? []).map((r) => [r.value, r]));
    for (const b of before.byDimension[dimension] ?? []) {
      const a = afterRows.get(b.value);
      if (!a || b.value === "" || b.sessions < MIN_BREAKDOWN_SESSIONS || a.sessions < MIN_BREAKDOWN_SESSIONS) continue;
      if (a.sessions > sessionsAfter * MAX_BREAKDOWN_SHARE && b.sessions > sessionsBefore * MAX_BREAKDOWN_SHARE) continue;
      const test = compareRates(b.errorSessions, b.sessions, a.errorSessions, a.sessions);
      if (test.after > test.before && test.p < 0.05) {
        breakdown.push({ dimension, value: b.value, sessionsBefore: b.sessions, sessionsAfter: a.sessions, rateBefore: test.before, rateAfter: test.after, ratio: test.ratio, p: test.p });
      }
    }
  }
  breakdown.sort((x, y) => x.p - y.p);

  const reasons = decision.reasons.map((f) => {
    const metric = metrics.find((m) => f.metric.startsWith(m.label.replace(" (75th percentile)", "")) || m.label === f.metric);
    const how = metric && metric.worseBy !== null ? `${(metric.worseBy * 100).toFixed(0)}% worse` : "worse";
    const hot = f.metric === "Sessions with an error" ? breakdown[0] : undefined;
    const where = hot ? `, concentrated on ${hot.dimension} ${hot.value} (${pct(hot.rateBefore)} to ${pct(hot.rateAfter)}, ${hot.sessionsAfter.toLocaleString("en")} sessions)` : "";
    return `${f.metric} ${how} (${pLabel(f.p)}, n=${f.n.toLocaleString("en")})${where}`;
  });

  const b = input.baselineWeekAgo;
  const baseline = b && b.sessions > 0 ? { errorRate: b.errorSessions / b.sessions, sessions: b.sessions } : null;
  const rollbackSuggested =
    decision.verdict === "regressed" && decision.reasons.some((f) => f.p < 0.001 && f.relativeChange !== null && f.relativeChange >= 0.5);

  return {
    release: input.release,
    previousRelease: input.previousRelease,
    deployedAt: input.deployedAt,
    windowHours: input.windowHours,
    comparable,
    verdict: decision.verdict,
    reasons,
    sessionsBefore,
    sessionsAfter,
    metrics,
    breakdown: breakdown.slice(0, 6),
    newIssues: input.newIssues,
    regressions: input.regressions,
    baseline,
    rollbackSuggested,
  };
}
