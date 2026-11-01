import { AnalyticsQueryError } from "../errors.js";
import { dispatch, readClient, type ReadVariant } from "../read-mode.js";
import {
  assertFunnelRange,
  stepCondition,
  type FunnelAnalysisRequest,
  type FunnelStepDefinition,
} from "./funnel-analysis.js";

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/** What a funnel can be split by. */
export const FUNNEL_SEGMENTS = {
  device: "device",
  country: "country",
  browser: "browser",
  os: "os",
  source: "campaign_source",
} as const;
export type FunnelSegment = keyof typeof FUNNEL_SEGMENTS;

export interface FunnelSegmentRow {
  segment: string;
  /** Sessions that reached step 1. */
  started: number;
  /** Sessions that reached each step, in step order. */
  reached: number[];
}

export interface FunnelTimingBucket {
  label: string;
  count: number;
}

export interface FunnelTiming {
  fromStep: number;
  toStep: number;
  samples: number;
  medianSeconds: number;
  p90Seconds: number;
  buckets: FunnelTimingBucket[];
}

export interface FunnelInsights {
  segments: FunnelSegmentRow[];
  timing: FunnelTiming[];
}

/** Upper bounds, in seconds, of the time-to-convert buckets (the last bucket is everything beyond). */
const BUCKETS: { label: string; max: number }[] = [
  { label: "<10s", max: 10 },
  { label: "<1m", max: 60 },
  { label: "<5m", max: 300 },
  { label: "<30m", max: 1800 },
  { label: "<1h", max: 3600 },
  { label: "1h+", max: Infinity },
];

function stepParams(steps: FunnelStepDefinition[]): Record<string, string> {
  const params: Record<string, string> = {};
  steps.forEach((s, idx) => {
    params[`step_${idx}_target`] = s.target;
  });
  return params;
}

function baseParams(request: FunnelAnalysisRequest, windowSeconds: number) {
  return {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    windowSeconds,
  };
}

const WHERE = `
  workspace_id = {workspaceId:UUID}
  AND site_id = {siteId:UUID}
  AND timestamp >= {from:DateTime64}
  AND timestamp <= {to:DateTime64}
  AND bot_status = 'human'`;

/** Per-segment reach at every step (top segments by entrants). */
export function buildSegmentQuery(steps: FunnelStepDefinition[], segment: FunnelSegment): string {
  const conditions = steps.map((s, idx) => stepCondition(idx, s.type));
  const column = FUNNEL_SEGMENTS[segment];
  return `
    SELECT seg AS segment, level, count() AS count
    FROM (
      SELECT
        session_id,
        if(trim(toString(any(${column}))) = '', 'Unknown', trim(toString(any(${column})))) AS seg,
        windowFunnel({windowSeconds:UInt32})(toDateTime(timestamp), ${conditions.join(", ")}) AS level
      FROM events_raw
      WHERE ${WHERE}
        AND (${conditions.join(" OR ")})
      GROUP BY session_id
    )
    GROUP BY segment, level
    LIMIT 2000
  `;
}

/**
 * Time between consecutive steps. Each session's events are ordered, then step k is the
 * first matching event after step k-1 (and within the funnel window), which is the same
 * reading windowFunnel uses for "reached". Layered subqueries keep each step's time
 * available to the next without nesting aggregates.
 */
export function buildTimingQuery(steps: FunnelStepDefinition[]): string {
  const conditions = steps.map((s, idx) => stepCondition(idx, s.type));
  const flags = conditions.map((c) => `toUInt8(${c})`).join(", ");

  // Layer 0: one sorted array of (ms, flag0, flag1, ...) per session.
  let sql = `
    SELECT arraySort(x -> x.1, groupArray((toUnixTimestamp64Milli(timestamp), ${flags}))) AS evs
    FROM events_raw
    WHERE ${WHERE}
      AND (${conditions.join(" OR ")})
    GROUP BY session_id`;

  for (let i = 0; i < steps.length; i += 1) {
    const flag = i + 2; // tuple element index of step i's flag
    const after =
      i === 0
        ? ""
        : ` AND e.1 >= t${i - 1} AND e.1 - t${i - 1} <= {windowSeconds:UInt32} * 1000`;
    const guard = i === 0 ? "" : `t${i - 1} > 0 AND `;
    sql = `
      SELECT *, if(${guard}1, arrayFirst(e -> e.${flag} = 1${after}, evs).1, 0) AS t${i}
      FROM (${sql})`;
  }

  const gaps: string[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    const d = `(t${i} - t${i - 1}) / 1000`;
    const ok = `t${i} > 0 AND t${i - 1} > 0`;
    gaps.push(`
      countIf(${ok}) AS n${i},
      quantileIf(0.5)(${d}, ${ok}) AS median${i},
      quantileIf(0.9)(${d}, ${ok}) AS p90${i},
      ${BUCKETS.map((b, k) => {
        const lo = k === 0 ? 0 : BUCKETS[k - 1]!.max;
        const hi = b.max;
        const range = Number.isFinite(hi) ? `${d} >= ${lo} AND ${d} < ${hi}` : `${d} >= ${lo}`;
        return `countIf(${ok} AND ${range}) AS b${i}_${k}`;
      }).join(",\n      ")}`);
  }
  return `SELECT ${gaps.join(",")} FROM (${sql})`;
}

async function insightsImpl(
  request: FunnelAnalysisRequest,
  steps: FunnelStepDefinition[],
  segment: FunnelSegment,
  windowSeconds: number,
  variant: ReadVariant
): Promise<FunnelInsights> {
  if (steps.length < 2) return { segments: [], timing: [] };
  assertFunnelRange(request.dateRange.from, request.dateRange.to);

  try {
    const client = readClient(variant);
    const params = { ...baseParams(request, windowSeconds), ...stepParams(steps) };
    const [segmentSet, timingSet] = await Promise.all([
      client.query({ query: buildSegmentQuery(steps, segment), query_params: params, format: "JSONEachRow" }),
      client.query({ query: buildTimingQuery(steps), query_params: params, format: "JSONEachRow" }),
    ]);

    const levelRows = await segmentSet.json<{ segment: string; level: string | number; count: string | number }>();
    const bySegment = new Map<string, number[]>();
    for (const row of levelRows) {
      const levels = bySegment.get(row.segment) ?? new Array<number>(steps.length + 1).fill(0);
      levels[Number(row.level)] = (levels[Number(row.level)] ?? 0) + Number(row.count);
      bySegment.set(row.segment, levels);
    }
    const segments: FunnelSegmentRow[] = [...bySegment.entries()]
      .map(([name, levels]) => {
        // reached[k] = sessions whose level is at least k + 1
        const reached = steps.map((_, k) => levels.slice(k + 1).reduce((a, b) => a + b, 0));
        return { segment: name, started: reached[0] ?? 0, reached };
      })
      .filter((row) => row.started > 0)
      .sort((a, b) => b.started - a.started)
      .slice(0, 8);

    const [timingRow] = await timingSet.json<Record<string, string | number | null>>();
    const num = (key: string) => Number(timingRow?.[key] ?? 0);
    const timing: FunnelTiming[] = [];
    for (let i = 1; i < steps.length; i += 1) {
      timing.push({
        fromStep: i,
        toStep: i + 1,
        samples: num(`n${i}`),
        medianSeconds: Math.round(num(`median${i}`)),
        p90Seconds: Math.round(num(`p90${i}`)),
        buckets: BUCKETS.map((b, k) => ({ label: b.label, count: num(`b${i}_${k}`) })),
      });
    }
    return { segments, timing };
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse funnel insights query failed", { cause: err });
  }
}

/** Segment breakdown and time-to-convert for a funnel. Failures throw. */
export function analyzeFunnelInsights(
  request: FunnelAnalysisRequest,
  steps: FunnelStepDefinition[],
  segment: FunnelSegment = "device",
  windowSeconds = 86400
): Promise<FunnelInsights> {
  return dispatch("analyzeFunnelInsights", (variant) => insightsImpl(request, steps, segment, windowSeconds, variant));
}
