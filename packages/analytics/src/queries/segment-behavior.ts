import { AnalyticsQueryError } from "../errors.js";
import { readClient, variantAware, type ReadVariant } from "../read-mode.js";
import { stepCondition } from "./funnel-analysis.js";

export interface BehaviorQuery {
  workspaceId: string;
  siteId: string;
  /** Identified users to test (distinct IDs). */
  distinctIds: string[];
  kind: "pageview" | "custom_event";
  /** A page path prefix or an event name. */
  target: string;
  days: number;
}

/**
 * Which of the given identified users viewed a page (or triggered an event) in the last
 * N days. Events carry their user's distinct ID once identify() has run, so this reads
 * it from the event properties.
 */
async function getDistinctIdsWithBehaviorImpl(query: BehaviorQuery, variant: ReadVariant): Promise<string[]> {
  if (query.distinctIds.length === 0) return [];
  try {
    const client = readClient(variant);
    const resultSet = await client.query({
      query: `
        SELECT DISTINCT JSONExtractString(properties_json, 'distinctId') AS distinct_id
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= now() - toIntervalDay({days:UInt16})
          AND bot_status = 'human'
          AND distinct_id IN {ids:Array(String)}
          AND ${stepCondition(0, query.kind)}
        LIMIT 100000
      `,
      query_params: {
        workspaceId: query.workspaceId,
        siteId: query.siteId,
        days: query.days,
        ids: query.distinctIds,
        step_0_target: query.target,
      },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ distinct_id: string }>();
    return rows.map((r) => r.distinct_id);
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse segment behaviour query failed", { cause: err });
  }
}

export const getDistinctIdsWithBehavior = variantAware("getDistinctIdsWithBehavior", getDistinctIdsWithBehaviorImpl);
