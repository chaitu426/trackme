import { getClickHouseClient } from "../client.js";

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
  conversionRateFromFirst: number; // e.g. 100%, 45%, 22%
  conversionRateFromPrevious: number; // e.g. 100%, 45%, 48%
  dropOffCount: number;
  dropOffRate: number; // e.g. 0%, 55%, 52%
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

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/**
 * Computes multi-step conversion funnels using ClickHouse windowFunnel.
 */
export async function analyzeFunnel(
  request: FunnelAnalysisRequest,
  steps: FunnelStepDefinition[],
  windowSeconds = 86400
): Promise<FunnelAnalysisResult> {
  if (steps.length === 0) {
    return {
      totalStarted: 0,
      totalCompleted: 0,
      overallConversionRate: 0,
      steps: [],
    };
  }

  // Construct conditions for each step
  const conditions = steps.map((s, idx) => {
    if (s.type === "pageview") {
      return `(type = 'pageview' AND (path = {step_${idx}_target:String} OR path LIKE concat({step_${idx}_target:String}, '%')))`;
    }
    return `(type = 'custom' AND (event_name = {step_${idx}_target:String} OR JSONExtractString(properties_json, 'goal') = {step_${idx}_target:String}))`;
  });

  const queryParams: Record<string, unknown> = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    windowSeconds,
  };

  steps.forEach((s, idx) => {
    queryParams[`step_${idx}_target`] = s.target;
  });

  try {
    const client = getClickHouseClient();

    const query = `
      SELECT
        level,
        count() AS count
      FROM (
        SELECT
          session_id,
          windowFunnel({windowSeconds:UInt32})(
            timestamp,
            ${conditions.join(",\n            ")}
          ) AS level
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= {from:DateTime64}
          AND timestamp <= {to:DateTime64}
          AND bot_status = 'human'
        GROUP BY session_id
      )
      GROUP BY level
      ORDER BY level ASC
    `;

    const resultSet = await client.query({
      query,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = await resultSet.json<{ level: number; count: string | number }>();
    const levelCounts: Record<number, number> = {};
    for (const r of rows) {
      levelCounts[Number(r.level)] = Number(r.count || 0);
    }

    // A session that reached level K reached all steps 1..K
    // So conversions for step i (1-indexed) = sum of counts for level >= i
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
        firstStepCount > 0
          ? Math.round((finalStepCount / firstStepCount) * 1000) / 10
          : 0,
      steps: stepResults,
    };
  } catch (err) {
    console.error("⚠️ [FunnelAnalysis] ClickHouse query failed:", err);
    // Graceful fallback with empty / zeroed steps
    return {
      totalStarted: 0,
      totalCompleted: 0,
      overallConversionRate: 0,
      steps: steps.map((s) => ({
        order: s.order,
        name: s.name,
        type: s.type,
        target: s.target,
        conversions: 0,
        conversionRateFromFirst: 0,
        conversionRateFromPrevious: 0,
        dropOffCount: 0,
        dropOffRate: 0,
      })),
    };
  }
}
