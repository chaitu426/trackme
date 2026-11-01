import { dispatch, readClient, type ReadVariant } from "../read-mode.js";
import { AnalyticsQueryError, AnalyticsRangeTooWideError } from "../errors.js";

export interface FunnelStepDefinition {
  order: number;
  name: string;
  type: "pageview" | "custom_event";
  target: string;
}

export interface FunnelStepResult {
  order: number;
  name: string;
  type: string;
  target: string;
  conversions: number;
  conversionRateFromFirst: number;
  conversionRateFromPrevious: number;
  dropOffCount: number;
  dropOffRate: number;
}

export interface FunnelAnalysisResult {
  totalStarted: number;
  totalCompleted: number;
  overallConversionRate: number;
  steps: FunnelStepResult[];
}

export interface FunnelAnalysisRequest {
  workspaceId: string;
  siteId: string;
  dateRange: {
    from: string;
    to: string;
    granularity?: string;
  };
}

/** Funnels still scan event-level rows; keep the raw window bounded. */
export const FUNNEL_MAX_RANGE_DAYS = 31;

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

export function stepCondition(idx: number, type: FunnelStepDefinition["type"]): string {
  if (type === "pageview") {
    return `(type = 'pageview' AND startsWith(path, {step_${idx}_target:String}))`;
  }
  return `(type = 'custom' AND (event_name = {step_${idx}_target:String} OR JSONExtractString(properties_json, 'goal') = {step_${idx}_target:String}))`;
}

export function assertFunnelRange(fromIso: string, toIso: string, maxDays = FUNNEL_MAX_RANGE_DAYS): void {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    throw new AnalyticsQueryError("Funnel date range is invalid");
  }
  const days = (toMs - fromMs) / 86_400_000;
  if (days > maxDays) {
    throw new AnalyticsRangeTooWideError(maxDays);
  }
}

export function buildFunnelAnalysisQuery(
  steps: FunnelStepDefinition[],
  windowSeconds: number
): { query: string; params: Record<string, unknown> } {
  const conditions = steps.map((s, idx) => stepCondition(idx, s.type));
  const query = `
      SELECT
        level,
        count() AS count
      FROM (
        SELECT
          session_id,
          windowFunnel({windowSeconds:UInt32})(
            toDateTime(timestamp),
            ${conditions.join(",\n            ")}
          ) AS level
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= {from:DateTime64}
          AND timestamp <= {to:DateTime64}
          AND bot_status = 'human'
          AND (${conditions.join(" OR ")})
        GROUP BY session_id
      )
      GROUP BY level
      ORDER BY level ASC
      SETTINGS optimize_aggregation_in_order = 1
    `;

  const params: Record<string, unknown> = { windowSeconds };
  steps.forEach((s, idx) => {
    params[`step_${idx}_target`] = s.target;
  });
  return { query, params };
}

function emptyResult(): FunnelAnalysisResult {
  return {
    totalStarted: 0,
    totalCompleted: 0,
    overallConversionRate: 0,
    steps: [],
  };
}

/**
 * Computes multi-step conversion funnels using ClickHouse windowFunnel.
 * Failures throw; callers must not treat an outage as zero conversions.
 */
export function analyzeFunnel(
  request: FunnelAnalysisRequest,
  steps: FunnelStepDefinition[],
  windowSeconds = 86400
): Promise<FunnelAnalysisResult> {
  return dispatch("analyzeFunnel", (variant) => analyzeFunnelImpl(request, steps, windowSeconds, variant));
}

async function analyzeFunnelImpl(
  request: FunnelAnalysisRequest,
  steps: FunnelStepDefinition[],
  windowSeconds: number,
  variant: ReadVariant
): Promise<FunnelAnalysisResult> {
  if (steps.length === 0) {
    return emptyResult();
  }

  assertFunnelRange(request.dateRange.from, request.dateRange.to);

  const built = buildFunnelAnalysisQuery(steps, windowSeconds);
  const queryParams: Record<string, unknown> = {
    ...built.params,
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
  };

  try {
    const client = readClient(variant);
    const resultSet = await client.query({
      query: built.query,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = await resultSet.json<{ level: number; count: string | number }>();
    const levelCounts: Record<number, number> = {};
    for (const r of rows) {
      levelCounts[Number(r.level)] = Number(r.count || 0);
    }

    const stepConversions: number[] = [];
    for (let i = 1; i <= steps.length; i++) {
      let sum = 0;
      for (const [lvl, cnt] of Object.entries(levelCounts)) {
        if (Number(lvl) >= i) {
          sum += cnt;
        }
      }
      stepConversions.push(sum);
    }

    const firstStepCount = stepConversions[0] || 0;
    const finalStepCount = stepConversions[stepConversions.length - 1] || 0;

    const stepResults: FunnelStepResult[] = steps.map((s, idx) => {
      const conv = stepConversions[idx] || 0;
      const prevConv = idx === 0 ? conv : stepConversions[idx - 1] || 0;
      const rateFromFirst = firstStepCount > 0 ? (conv / firstStepCount) * 100 : 0;
      const rateFromPrev = prevConv > 0 ? (conv / prevConv) * 100 : 0;
      const dropOffCount = Math.max(0, prevConv - conv);
      const dropOffRate = prevConv > 0 ? (dropOffCount / prevConv) * 100 : 0;

      return {
        order: s.order,
        name: s.name,
        type: s.type,
        target: s.target,
        conversions: conv,
        conversionRateFromFirst: Math.round(rateFromFirst * 10) / 10,
        conversionRateFromPrevious: Math.round(rateFromPrev * 10) / 10,
        dropOffCount,
        dropOffRate: Math.round(dropOffRate * 10) / 10,
      };
    });

    return {
      totalStarted: firstStepCount,
      totalCompleted: finalStepCount,
      overallConversionRate:
        firstStepCount > 0 ? Math.round((finalStepCount / firstStepCount) * 1000) / 10 : 0,
      steps: stepResults,
    };
  } catch (err) {
    if (err instanceof AnalyticsQueryError || err instanceof AnalyticsRangeTooWideError) {
      throw err;
    }
    throw new AnalyticsQueryError("ClickHouse funnel query failed", { cause: err });
  }
}
