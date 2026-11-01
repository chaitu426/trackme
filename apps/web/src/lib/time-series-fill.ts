import type { TimeSeriesPoint } from "@trackme/analytics";

const STEP_MS = { hour: 3_600_000, day: 86_400_000 } as const;

/**
 * ClickHouse only returns buckets that contain events, so a quiet site gets one or two
 * points and every chart over it collapses. This lays the points on the full range
 * (UTC buckets, matching toStartOfHour/toStartOfDay) with zeros for the empty buckets.
 */
export function fillTimeSeries(
  points: TimeSeriesPoint[],
  range: { from: string; to: string },
  granularity: "hour" | "day"
): TimeSeriesPoint[] {
  const step = STEP_MS[granularity];
  const start = Math.floor(Date.parse(range.from) / step) * step;
  const end = Math.floor(Date.parse(range.to) / step) * step;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return points;

  const key = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z";
  const byBucket = new Map(points.map((p) => [p.timestamp, p]));
  const filled: TimeSeriesPoint[] = [];
  for (let t = start; t <= end; t += step) {
    const stamp = key(t);
    filled.push(
      byBucket.get(stamp) ?? { timestamp: stamp, visitors: 0, sessions: 0, pageviews: 0, bounceRate: 0, avgDuration: 0 }
    );
  }
  return filled;
}
