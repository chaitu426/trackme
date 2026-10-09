/**
 * Splits a rolling time range into whole UTC days and the two partial days at
 * its edges.
 *
 * Daily rollup tables can only answer for whole calendar days, but dashboard
 * ranges are rolling ("the last 7 days" ends now and starts 7×24h ago). Reading
 * rollups for every day the range touches would count the whole first day and
 * miss the unfinished current day. Instead, whole days inside the range come
 * from the rollups and only the two edges are read from raw events.
 *
 *   from                                                         to
 *     |-- head --|-------- whole days (rollups) --------|-- tail --|
 *               headEnd                              tailStart
 *            (next UTC midnight)                (midnight before `to`)
 */
export interface RangeSplit {
  /** True when at least one whole UTC day lies inside the range. */
  hasFullDays: boolean;
  /** End of the head edge: `from` if it is already midnight, else the next midnight. */
  headEnd: Date;
  /** Start of the tail edge: the UTC midnight at or before `to`. */
  tailStart: Date;
  /** First whole day, inclusive, as YYYY-MM-DD. */
  fullFromDate: string;
  /** End of the whole days, exclusive, as YYYY-MM-DD. */
  fullToDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function splitRange(fromIso: string, toIso: string): RangeSplit {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    throw new RangeError(`Invalid date range: ${fromIso} .. ${toIso}`);
  }

  const headEnd = from % DAY_MS === 0 ? from : startOfUtcDay(from) + DAY_MS;
  const tailStart = startOfUtcDay(to);
  const hasFullDays = tailStart > headEnd;

  return {
    hasFullDays,
    headEnd: new Date(headEnd),
    tailStart: new Date(tailStart),
    fullFromDate: isoDate(headEnd),
    fullToDate: isoDate(tailStart),
  };
}

/** ClickHouse DateTime64 literal for a Date, as the other queries format them. */
export function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
