/**
 * Which UTC days a rollup run must recompute.
 *
 * The old jobs recomputed a fixed trailing window (two hours, two days). Any
 * downtime longer than that left a permanent hole, because the next run never
 * looked back far enough. Here the start is derived from what the rollup table
 * already holds, so a run always resumes where the table ends.
 *
 * Rollup inserts are idempotent (ReplacingMergeTree keeps the newest copy per
 * key), so recomputing a day twice is harmless.
 */
export interface WindowInput {
  /** Today in UTC, YYYY-MM-DD. */
  today: string;
  /** Newest day already present in the rollup table, or null if it is empty. */
  lastDate: string | null;
  /** Oldest day with raw events, or null if there are none. Only used to seed an empty table. */
  earliestEvent: string | null;
  /** Always recompute this many days before today, so late events are picked up. */
  lookbackDays: number;
  /** Never reach further back than this many days, even to repair a gap. */
  backfillDays: number;
  /** Cap on days processed in one run, so a long backlog cannot outlive the job lock. */
  maxDaysPerRun: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(date: string): number {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid date: ${date}`);
  return ms;
}

function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function planDays(input: WindowInput): string[] {
  const today = toMs(input.today);
  const oldestAllowed = today - input.backfillDays * DAY_MS;
  const lookbackStart = today - input.lookbackDays * DAY_MS;

  let start: number;
  if (input.lastDate === null) {
    // Empty table: seed it from the first day with data, within the backfill limit.
    const first = input.earliestEvent === null ? today : toMs(input.earliestEvent);
    start = Math.max(first, oldestAllowed);
  } else {
    // Resume one day before the newest rolled-up day (that day may have been
    // partial when it was written), but always cover the lookback window.
    start = Math.min(lookbackStart, toMs(input.lastDate) - DAY_MS);
    start = Math.max(start, oldestAllowed);
  }
  start = Math.min(start, today);

  const days: string[] = [];
  for (let ms = start; ms <= today && days.length < input.maxDaysPerRun; ms += DAY_MS) {
    days.push(toDate(ms));
  }
  return days;
}
