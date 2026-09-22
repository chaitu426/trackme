import { MetricQueryRequest } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";

export interface CustomEventSummary {
  eventName: string;
  count: number;
  uniqueSessions: number;
  uniqueVisitors: number;
  lastSeen: string;
}

export interface GoalDefinition {
  id: string;
  name: string;
  type: string; // 'pageview_rule' | 'custom_event'
  eventName: string | null;
  pathPattern: string | null;
  targetValue: string | number | null;
  enabled: boolean;
}

export interface GoalMetric {
  id: string;
  name: string;
  type: string;
  eventName: string | null;
  pathPattern: string | null;
  targetValue: number | null;
  enabled: boolean;
  conversions: number;
  convertingVisitors: number;
  conversionRate: number; // percentage e.g. 4.5
}

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/**
 * Summarize tracked custom events over a date range.
 */
export async function getCustomEventsSummary(
  request: MetricQueryRequest
): Promise<CustomEventSummary[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      event_name,
      count(*) AS count,
      uniqExact(session_id) AS unique_sessions,
      uniqExact(visitor_pseudonym) AS unique_visitors,
      formatDateTime(max(timestamp), '%Y-%m-%dT%H:%i:%SZ') AS last_seen
    FROM events_raw
    WHERE workspace_id = {workspaceId:UUID}
      AND site_id = {siteId:UUID}
      AND timestamp >= {from:DateTime64}
      AND timestamp <= {to:DateTime64}
      AND type = 'custom'
      AND bot_status = 'human'
    GROUP BY event_name
    ORDER BY count DESC
    LIMIT {limit:UInt32}
  `;

  const resultSet = await client.query({
    query,
    query_params: {
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      from: toCH(request.dateRange.from),
      to: toCH(request.dateRange.to),
      limit: request.limit || 50,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    event_name: string;
    count: string | number;
    unique_sessions: string | number;
    unique_visitors: string | number;
    last_seen: string;
  }>();

  return rows.map((row) => ({
    eventName: row.event_name,
    count: Number(row.count || 0),
    uniqueSessions: Number(row.unique_sessions || 0),
    uniqueVisitors: Number(row.unique_visitors || 0),
    lastSeen: row.last_seen,
  }));
}

/**
 * Calculate conversion metrics for a list of defined conversion goals.
 */
export async function getGoalMetrics(
  workspaceId: string,
  siteId: string,
  goals: GoalDefinition[],
  dateRange: { from: string; to: string }
): Promise<GoalMetric[]> {
  if (goals.length === 0) {
    return [];
  }

  const client = getClickHouseClient();
  const fromCH = toCH(dateRange.from);
  const toCHVal = toCH(dateRange.to);

  // 1. Get total unique visitors in period for baseline conversion rate
  const totalResultSet = await client.query({
    query: `
      SELECT uniqExact(visitor_pseudonym) AS total_visitors
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND timestamp >= {from:DateTime64}
        AND timestamp <= {to:DateTime64}
        AND bot_status = 'human'
    `,
    query_params: {
      workspaceId,
      siteId,
      from: fromCH,
      to: toCHVal,
    },
    format: "JSONEachRow",
  });

  const totalRows = await totalResultSet.json<{ total_visitors: string | number }>();
  const totalVisitors = Number(totalRows[0]?.total_visitors || 0);

  // 2. Query conversions for each goal
  const metrics: GoalMetric[] = [];

  for (const goal of goals) {
    let whereClause = "";
    const params: Record<string, string | number> = {
      workspaceId,
      siteId,
      from: fromCH,
      to: toCHVal,
    };

    if (goal.type === "pageview_rule" && goal.pathPattern) {
      if (goal.pathPattern.includes("%") || goal.pathPattern.includes("*")) {
        params.pattern = goal.pathPattern.replace(/\*/g, "%");
        whereClause = `AND type = 'pageview' AND path LIKE {pattern:String}`;
      } else {
        params.path = goal.pathPattern;
        whereClause = `AND type = 'pageview' AND path = {path:String}`;
      }
    } else if (goal.type === "custom_event" && goal.eventName) {
      params.eventName = goal.eventName;
      whereClause = `AND type = 'custom' AND event_name = {eventName:String}`;
    } else {
      metrics.push({
        id: goal.id,
        name: goal.name,
        type: goal.type,
        eventName: goal.eventName,
        pathPattern: goal.pathPattern,
        targetValue: goal.targetValue ? Number(goal.targetValue) : null,
        enabled: goal.enabled,
        conversions: 0,
        convertingVisitors: 0,
        conversionRate: 0,
      });
      continue;
    }

    const query = `
      SELECT
        count(*) AS conversions,
        uniqExact(visitor_pseudonym) AS converting_visitors
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND timestamp >= {from:DateTime64}
        AND timestamp <= {to:DateTime64}
        AND bot_status = 'human'
        ${whereClause}
    `;

    const res = await client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = await res.json<{
      conversions: string | number;
      converting_visitors: string | number;
    }>();

    const conversions = Number(rows[0]?.conversions || 0);
    const convertingVisitors = Number(rows[0]?.converting_visitors || 0);
    const conversionRate =
      totalVisitors > 0 ? Math.round((convertingVisitors / totalVisitors) * 1000) / 10 : 0;

    metrics.push({
      id: goal.id,
      name: goal.name,
      type: goal.type,
      eventName: goal.eventName,
      pathPattern: goal.pathPattern,
      targetValue: goal.targetValue ? Number(goal.targetValue) : null,
      enabled: goal.enabled,
      conversions,
      convertingVisitors,
      conversionRate,
    });
  }

  return metrics;
}
