/**
 * Statistics for comparing "before" and "after" a release. Pure functions, no I/O.
 *
 * Two tests, chosen for what the data is:
 *  - rates (sessions that hit an error, sessions that converted): two-proportion z-test with a pooled variance.
 *  - latencies (LCP, INP, API time): Mann-Whitney U with tie correction and a normal approximation. Latencies are
 *    skewed with outliers, so comparing ranks is safer than comparing means. Valid from about 8 samples a side.
 * Every result carries an effect size, not only a p-value: with enough traffic a trivial difference is "significant".
 */

/** Standard normal CDF, absolute error under about 1e-7: ample for p-values, which are read to two or three digits. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

function erfc(x: number): number {
  // Numerical Recipes erfc (Chebyshev fit), relative error below 1.2e-7 everywhere.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** Two-sided p-value of a z statistic. */
export const twoSidedP = (z: number): number => 2 * (1 - normalCdf(Math.abs(z)));

export interface RateTest {
  /** Rate before and after, as fractions. */
  before: number;
  after: number;
  /** after / before; null when before is 0. 1.5 means 50% higher. */
  ratio: number | null;
  /** after - before, in fraction points. */
  diff: number;
  z: number;
  /** Two-sided. */
  p: number;
}

/** Did the share of sessions with some outcome change? x events out of n sessions on each side. */
export function compareRates(xBefore: number, nBefore: number, xAfter: number, nAfter: number): RateTest {
  const before = nBefore > 0 ? xBefore / nBefore : 0;
  const after = nAfter > 0 ? xAfter / nAfter : 0;
  const pooled = nBefore + nAfter > 0 ? (xBefore + xAfter) / (nBefore + nAfter) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(nBefore, 1) + 1 / Math.max(nAfter, 1)));
  const z = se > 0 ? (after - before) / se : 0;
  return { before, after, ratio: before > 0 ? after / before : null, diff: after - before, z, p: se > 0 ? twoSidedP(z) : 1 };
}

export interface RankTest {
  nBefore: number;
  nAfter: number;
  medianBefore: number;
  medianAfter: number;
  /** Probability that a random "after" sample is larger than a random "before" one (0.5 = no difference). */
  probabilityHigher: number;
  z: number;
  p: number;
}

/** Midranks of the combined sample (ties share the average rank) and the tie term for the variance correction. */
function rankSums(a: number[], b: number[]): { rankSumA: number; tieTerm: number } {
  const all = [...a.map((value) => ({ value, group: 0 })), ...b.map((value) => ({ value, group: 1 }))].sort((x, y) => x.value - y.value);
  let rankSumA = 0;
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.value === all[i]!.value) j += 1;
    const midrank = (i + 1 + j) / 2;
    const ties = j - i;
    tieTerm += ties ** 3 - ties;
    for (let k = i; k < j; k += 1) if (all[k]!.group === 0) rankSumA += midrank;
    i = j;
  }
  return { rankSumA, tieTerm };
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Did the distribution of a latency shift? Needs a few samples on each side; returns p = 1 below 2. */
export function compareLatencies(before: number[], after: number[]): RankTest {
  const n1 = before.length;
  const n2 = after.length;
  const base = { nBefore: n1, nAfter: n2, medianBefore: median(before), medianAfter: median(after) };
  if (n1 < 2 || n2 < 2) return { ...base, probabilityHigher: 0.5, z: 0, p: 1 };

  const { rankSumA: rankSumBefore, tieTerm } = rankSums(before, after);
  const uBefore = rankSumBefore - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  const n = n1 + n2;
  const variance = ((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  // Continuity correction of 0.5 towards the mean.
  const z = variance > 0 ? (uBefore - mean + (uBefore < mean ? 0.5 : uBefore > mean ? -0.5 : 0)) / Math.sqrt(variance) : 0;
  return {
    ...base,
    // uBefore counts pairs where before > after; "after higher" is the complement.
    probabilityHigher: 1 - uBefore / (n1 * n2),
    z: -z,
    p: variance > 0 ? twoSidedP(z) : 1,
  };
}

export type Verdict = "healthy" | "watch" | "regressed" | "collecting";

export interface MetricFinding {
  metric: string;
  /** Higher is worse for every metric passed here (error rate, latency). Flip the sign for "higher is better" before calling. */
  worse: boolean;
  p: number;
  /** Relative change, after vs before (0.5 = 50% worse); null when before is zero. */
  relativeChange: number | null;
  /** Samples or sessions behind the smaller side. */
  n: number;
}

export interface VerdictRules {
  /** Sessions each side needs before any verdict is shown. */
  minSessions: number;
  /** p below this, and a big enough change, is Regressed. */
  regressedP: number;
  watchP: number;
  /** Smallest relative worsening that counts, so a trivial change is not flagged however significant. */
  regressedMinChange: number;
  watchMinChange: number;
}

export const DEFAULT_RULES: VerdictRules = { minSessions: 500, regressedP: 0.01, watchP: 0.05, regressedMinChange: 0.2, watchMinChange: 0.1 };

/**
 * One verdict from many metrics. Below the sample gate there is NO verdict ("collecting"), never a guess. A metric must be
 * both statistically significant and practically large to count; the reasons that triggered the verdict are returned so the
 * page can show them. The p thresholds apply per metric, so with m metrics tested the chance of at least one false alarm
 * is higher than the nominal level; the effect-size floor is what keeps that in check.
 */
export function decideVerdict(
  sessionsBefore: number,
  sessionsAfter: number,
  findings: MetricFinding[],
  rules: VerdictRules = DEFAULT_RULES
): { verdict: Verdict; reasons: MetricFinding[] } {
  if (Math.min(sessionsBefore, sessionsAfter) < rules.minSessions) return { verdict: "collecting", reasons: [] };

  const worse = findings.filter((f) => f.worse && f.relativeChange !== null);
  const regressed = worse.filter((f) => f.p < rules.regressedP && f.relativeChange! >= rules.regressedMinChange);
  if (regressed.length > 0) return { verdict: "regressed", reasons: regressed };
  const watch = worse.filter((f) => f.p < rules.watchP && f.relativeChange! >= rules.watchMinChange);
  if (watch.length > 0) return { verdict: "watch", reasons: watch };
  return { verdict: "healthy", reasons: [] };
}
