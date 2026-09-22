export type RangeKey = "24h" | "7d" | "30d";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

const RANGE_MS: Record<RangeKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function parseRangeKey(value: string | string[] | undefined): RangeKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "24h" || raw === "7d" || raw === "30d" ? raw : "30d";
}

/**
 * Resolves a range key into the current window plus the immediately
 * preceding window of the same length, so callers can compute real
 * period-over-period change instead of a hardcoded delta.
 */
export function resolveDateRange(range: RangeKey, now: Date = new Date()) {
  const durationMs = RANGE_MS[range];
  const to = now;
  const from = new Date(to.getTime() - durationMs);
  const previousTo = from;
  const previousFrom = new Date(from.getTime() - durationMs);

  return {
    current: { from: from.toISOString(), to: to.toISOString() },
    previous: { from: previousFrom.toISOString(), to: previousTo.toISOString() },
  };
}

/**
 * Percent change vs. the prior period. Returns null when there's no
 * meaningful baseline (zero in the prior period) rather than showing a
 * fabricated or infinite percentage.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
