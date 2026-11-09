/**
 * Gateway incident detection over 5-minute buckets of payment outcomes. Pure, so it is tested without a database.
 *
 * A bucket is "bad" when its failures are too many to be chance given the gateway's own normal failure rate: the probability
 * of at least that many failures among that many outcomes, if the gateway were behaving as usual, is under 0.001. This
 * adapts to a gateway that always fails a few percent (cards) and ignores a quiet bucket with one unlucky payment.
 * The norm is the pooled success rate with the bad buckets taken out, found in two passes.
 */

export interface HealthBucket {
  startMs: number;
  paid: number;
  failed: number;
  /** Most common failure code among the failures in this bucket. */
  topFailure: string;
}

export interface Incident {
  startMs: number;
  /** End of the last bad bucket. */
  endMs: number;
  outcomes: number;
  failed: number;
  successRate: number;
  topFailure: string;
  ongoing: boolean;
}

const BUCKET_MS = 300_000;
const P_VALUE = 0.001;
const MIN_OUTCOMES = 3;
const MERGE_GAP_BUCKETS = 3;
const MIN_INCIDENT_FAILURES = 5;
const MIN_HISTORY_OUTCOMES = 30;

/** P(X >= k) for X ~ Binomial(n, p), summed from the small side for stability. */
export function binomialTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let term = Math.pow(1 - p, n); // P(X = 0)
  let cdf = 0;
  for (let i = 0; i < k; i += 1) {
    cdf += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.max(0, 1 - cdf);
}

function flag(buckets: HealthBucket[], failureRate: number): boolean[] {
  // Never let a gateway with a 0% norm make a single failure significant.
  const p = Math.max(failureRate, 0.01);
  return buckets.map((b) => b.paid + b.failed >= MIN_OUTCOMES && binomialTail(b.paid + b.failed, b.failed, p) < P_VALUE);
}

export function detectIncidents(buckets: HealthBucket[], nowMs: number): Incident[] {
  const sorted = [...buckets].sort((a, b) => a.startMs - b.startMs);
  const total = sorted.reduce((s, b) => s + b.paid + b.failed, 0);
  if (total < MIN_HISTORY_OUTCOMES) return [];

  const rate = (use: HealthBucket[]) => {
    const t = use.reduce((s, b) => s + b.paid + b.failed, 0);
    return t === 0 ? 0 : use.reduce((s, b) => s + b.failed, 0) / t;
  };
  let bad = flag(sorted, rate(sorted));
  bad = flag(sorted, rate(sorted.filter((_, i) => !bad[i])));

  const incidents: Incident[] = [];
  let current: HealthBucket[] = [];
  let lastBad = -Infinity;
  const close = () => {
    if (current.length === 0) return;
    const failed = current.reduce((s, b) => s + b.failed, 0);
    const outcomes = current.reduce((s, b) => s + b.paid + b.failed, 0);
    if (failed >= MIN_INCIDENT_FAILURES) {
      const codes = new Map<string, number>();
      for (const b of current) if (b.topFailure) codes.set(b.topFailure, (codes.get(b.topFailure) ?? 0) + b.failed);
      const top = [...codes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const endMs = current[current.length - 1]!.startMs + BUCKET_MS;
      incidents.push({
        startMs: current[0]!.startMs, endMs, outcomes, failed, successRate: (outcomes - failed) / outcomes, topFailure: top,
        ongoing: endMs >= nowMs - MERGE_GAP_BUCKETS * BUCKET_MS,
      });
    }
    current = [];
  };
  sorted.forEach((b, i) => {
    if (!bad[i]) return;
    if (current.length > 0 && b.startMs - lastBad > MERGE_GAP_BUCKETS * BUCKET_MS) close();
    // Everything between the first and last bad bucket belongs to the incident, including the quiet buckets between.
    current.push(b);
    lastBad = b.startMs;
  });
  close();
  return incidents;
}
