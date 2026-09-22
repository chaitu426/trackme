import { MetricQueryRequest, OverviewMetricsResponse } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";
import { buildDimensionFilterSql } from "./filters.js";

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

function rangeHours(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

/**
 * Overview KPIs with period-accurate uniques.
 *
 * Short windows (<48h, or filtered): full engagement from events_raw
 * (session-weighted bounce/duration).
 *
 * Long unfiltered ranges: pageviews + bounce/duration from rollups;
 * period visitors/sessions still uniqExact on events_raw (no window fn).
 * Never sum(daily unique_visitors).
 */
export async function getOverviewMetrics(
  request: MetricQueryRequest
): Promise<OverviewMetricsResponse> {
  const client = getClickHouseClient();
  const filter = buildDimensionFilterSql(request.filters);
  const hours = rangeHours(request.dateRange.from, request.dateRange.to);
  const useRollups = hours > 48 && !request.filters;

  const params = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    ...filter.params,
  };

  if (useRollups) {
    const [uniques, engagement, pageviewRollup] = await Promise.all([
      client.query({
        query: `
          SELECT
            uniqExact(visitor_pseudonym) AS visitors,
            uniqExact(session_id) AS sessions
          FROM events_raw
          WHERE workspace_id = {workspaceId:UUID}
            AND site_id = {siteId:UUID}
            AND timestamp >= {from:DateTime64}
            AND timestamp <= {to:DateTime64}
            AND bot_status = 'human'
        `,
        query_params: params,
        format: "JSONEachRow",
      }),
      client.query({
        query: `
          SELECT
            sum(sessions) AS sessions,
            sum(bounced_sessions) AS bounced_sessions,
            sum(total_duration_seconds) AS total_duration_seconds
          FROM session_engagement_daily FINAL
          WHERE workspace_id = {workspaceId:UUID}
            AND site_id = {siteId:UUID}
            AND date >= toDate({from:DateTime64})
            AND date <= toDate({to:DateTime64})
        `,
        query_params: params,
        format: "JSONEachRow",
      }),
      client.query({
        query: `
          SELECT sum(pageviews) AS pageviews
          FROM pageview_rollups_daily FINAL
          WHERE workspace_id = {workspaceId:UUID}
            AND site_id = {siteId:UUID}
            AND date >= toDate({from:DateTime64})
            AND date <= toDate({to:DateTime64})
        `,
        query_params: params,
        format: "JSONEachRow",
      }),
    ]);

    const u = (await uniques.json<{ visitors: string | number; sessions: string | number }>())[0];
    const e = (await engagement.json<{
      sessions: string | number;
      bounced_sessions: string | number;
      total_duration_seconds: string | number;
    }>())[0];
    const p = (await pageviewRollup.json<{ pageviews: string | number }>())[0];

    const rollupSessions = Number(e?.sessions || 0);
    const bounced = Number(e?.bounced_sessions || 0);
    const durationSum = Number(e?.total_duration_seconds || 0);
    const pageviews = Number(p?.pageviews || 0);

    // Engagement rollups empty (pre-first daily job): fall back to raw once.
    if (rollupSessions === 0) {
      return getOverviewMetricsRaw(request, params, filter.clause);
    }

    return {
      siteId: request.siteId,
      dateRange: request.dateRange,
      visitors: Number(u?.visitors || 0),
      sessions: Number(u?.sessions || 0),
      pageviews,
      bounceRatePercentage:
        rollupSessions > 0 ? Math.round((bounced / rollupSessions) * 1000) / 10 : 0,
      avgDurationSeconds: rollupSessions > 0 ? Math.round(durationSum / rollupSessions) : 0,
      activeVisitorsNow: 0,
    };
  }

  return getOverviewMetricsRaw(request, params, filter.clause);
}

async function getOverviewMetricsRaw(
  request: MetricQueryRequest,
  params: Record<string, unknown>,
  filterClause: string
): Promise<OverviewMetricsResponse> {
  const client = getClickHouseClient();
  const engagementSet = await client.query({
    query: `
      SELECT
        uniqExact(visitor_pseudonym) AS visitors,
        count() AS sessions,
        sum(pageview_count) AS pageviews,
        round(countIf(pageview_count = 1) / nullIf(count(), 0) * 100, 1) AS bounce_rate_percentage,
        round(avg(session_duration_seconds), 0) AS avg_duration_seconds
      FROM (
        SELECT
          session_id,
          any(visitor_pseudonym) AS visitor_pseudonym,
          countIf(type = 'pageview') AS pageview_count,
          dateDiff('second', min(timestamp), max(timestamp)) AS session_duration_seconds
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= {from:DateTime64}
          AND timestamp <= {to:DateTime64}
          AND bot_status = 'human'
          ${filterClause}
        GROUP BY session_id
      )
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  const engagement = (await engagementSet.json<{
    visitors: string | number;
    sessions: string | number;
    pageviews: string | number;
    bounce_rate_percentage: string | number | null;
    avg_duration_seconds: string | number | null;
  }>())[0] ?? {
    visitors: 0,
    sessions: 0,
    pageviews: 0,
    bounce_rate_percentage: 0,
    avg_duration_seconds: 0,
  };

  return {
    siteId: request.siteId,
    dateRange: request.dateRange,
    visitors: Number(engagement.visitors || 0),
    sessions: Number(engagement.sessions || 0),
    pageviews: Number(engagement.pageviews || 0),
    bounceRatePercentage: Number(engagement.bounce_rate_percentage || 0),
    avgDurationSeconds: Number(engagement.avg_duration_seconds || 0),
    activeVisitorsNow: 0,
  };
}
