import { MetricQueryRequest, OverviewMetricsResponse } from "@trackme/contracts";
import { getDashboardClickHouseClient } from "../client.js";
import { dispatch, readClient } from "../read-mode.js";
import { buildDimensionFilterSql } from "./filters.js";
import { SESSION_DURATION_SQL, SESSION_ENGAGED_SQL, SESSION_ENGAGEMENT_COLUMNS } from "./engagement-sql.js";

import { assertRawScanRange, splitRange, toClickHouseDateTime } from "./range-split.js";

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

function rangeHours(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

type Params = Record<string, unknown>;
type Built = { query: string; params: Params };

const TENANT = `workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}`;
const FULL_DAYS = `date >= {fullFrom:Date} AND date < {fullTo:Date}`;
// The two partial days at the ends of a rolling range, read from raw events.
const EDGES = `(
  (timestamp >= {from:DateTime64} AND timestamp < {headEnd:DateTime64})
  OR (timestamp >= {tailStart:DateTime64} AND timestamp <= {to:DateTime64})
)`;

/**
 * SQL for the long-range overview. Whole UTC days come from the daily rollup
 * tables; only the head and tail edges touch events_raw, so the raw scan is
 * bounded to about two days whatever the range length. See range-split.ts.
 *
 * Each query returns a `part` column ("rollup" or "edge") so the caller can tell
 * whether the rollups had anything for the whole days.
 */
export function buildRollupOverviewQueries(
  request: MetricQueryRequest,
  filterParams: Params = {}
): { uniques: Built; pageviews: Built; engagement: Built } | null {
  const split = splitRange(request.dateRange.from, request.dateRange.to);
  if (!split.hasFullDays) return null;

  const params: Params = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    headEnd: toClickHouseDateTime(split.headEnd),
    tailStart: toClickHouseDateTime(split.tailStart),
    fullFrom: split.fullFromDate,
    fullTo: split.fullToDate,
    ...filterParams,
  };

  const uniques = `
    SELECT
      uniqCombined64Merge(v) AS visitors,
      uniqCombined64Merge(s) AS sessions
    FROM (
      SELECT visitors_state AS v, sessions_state AS s
      FROM daily_uniques FINAL
      WHERE ${TENANT} AND ${FULL_DAYS}
      UNION ALL
      SELECT uniqCombined64State(visitor_pseudonym) AS v, uniqCombined64State(session_id) AS s
      FROM events_raw
      WHERE ${TENANT} AND bot_status = 'human' AND ${EDGES}
    )
  `;

  const pageviews = `
    SELECT 'rollup' AS part, toUInt64(sum(pageviews)) AS pageviews
    FROM pageview_rollups_daily FINAL
    WHERE ${TENANT} AND ${FULL_DAYS}
    UNION ALL
    SELECT 'edge' AS part, toUInt64(countIf(type = 'pageview')) AS pageviews
    FROM events_raw
    WHERE ${TENANT} AND bot_status = 'human' AND ${EDGES}
  `;

  // A session is counted on the day it started. At the two edges, sessions are
  // those seen in the edge window, grouped per edge so one session is never
  // stretched across the whole days between them.
  const engagement = `
    SELECT
      'rollup' AS part,
      toUInt64(sum(sessions)) AS sessions,
      toUInt64(sum(bounced_sessions)) AS bounced,
      toUInt64(sum(total_duration_seconds)) AS duration
    FROM session_engagement_daily FINAL
    WHERE ${TENANT} AND ${FULL_DAYS}
    UNION ALL
    SELECT
      'edge' AS part,
      toUInt64(count()) AS sessions,
      toUInt64(countIf(NOT ${SESSION_ENGAGED_SQL})) AS bounced,
      toUInt64(sum(${SESSION_DURATION_SQL})) AS duration
    FROM (
      SELECT ${SESSION_ENGAGEMENT_COLUMNS}
      FROM events_raw
      WHERE ${TENANT} AND bot_status = 'human' AND ${EDGES}
      GROUP BY session_id, timestamp >= {tailStart:DateTime64}
    )
  `;

  return {
    uniques: { query: uniques, params },
    pageviews: { query: pageviews, params },
    engagement: { query: engagement, params },
  };
}

/**
 * Overview KPIs with period-accurate uniques.
 *
 * Short windows (<48h, or filtered): full engagement from events_raw
 * (session-weighted bounce/duration).
 *
 * Long unfiltered ranges: whole UTC days from the rollup tables (pageviews,
 * session engagement, and merged distinct-count states for visitors and
 * sessions) plus the two partial edge days from raw events. Distinct counts are
 * merged from states, never summed across days.
 */
async function getOverviewMetricsV1(
  request: MetricQueryRequest
): Promise<OverviewMetricsResponse> {
  const client = getDashboardClickHouseClient();
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

  const built = useRollups ? buildRollupOverviewQueries(request, filter.params) : null;
  if (!built) {
    return getOverviewMetricsRaw(request, params, filter.clause);
  }

  const run = async <T>(q: Built) =>
    (await client.query({ query: q.query, query_params: q.params, format: "JSONEachRow" })).json<T>();

  let uniqueRows: { visitors: string | number; sessions: string | number }[];
  let pageviewRows: { part: string; pageviews: string | number }[];
  let engagementRows: {
    part: string;
    sessions: string | number;
    bounced: string | number;
    duration: string | number;
  }[];
  try {
    [uniqueRows, pageviewRows, engagementRows] = await Promise.all([
      run<{ visitors: string | number; sessions: string | number }>(built.uniques),
      run<{ part: string; pageviews: string | number }>(built.pageviews),
      run<{ part: string; sessions: string | number; bounced: string | number; duration: string | number }>(
        built.engagement
      ),
    ]);
  } catch (error) {
    // Most likely a migration that has not been applied yet (for example
    // daily_uniques). Slower beats a dashboard that returns an error.
    console.warn("Rollup overview failed, answering from raw events instead:", error);
    return getOverviewMetricsRaw(request, params, filter.clause);
  }

  const u = uniqueRows[0];
  const rollupEngagement = engagementRows.find((r) => r.part === "rollup");

  // The whole days have no engagement rollup rows: the rollup jobs have not
  // caught up yet (new install, or recovering from downtime). Answer from raw
  // events rather than report a range that silently lacks most of its days.
  if (Number(rollupEngagement?.sessions || 0) === 0) {
    return getOverviewMetricsRaw(request, params, filter.clause);
  }

  const sum = (rows: { [k: string]: string | number }[], key: string) =>
    rows.reduce((total, r) => total + Number(r[key] || 0), 0);
  const sessions = sum(engagementRows, "sessions");
  const bounced = sum(engagementRows, "bounced");
  const duration = sum(engagementRows, "duration");

  return {
    siteId: request.siteId,
    dateRange: request.dateRange,
    visitors: Number(u?.visitors || 0),
    sessions: Number(u?.sessions || 0),
    pageviews: sum(pageviewRows, "pageviews"),
    bounceRatePercentage: sessions > 0 ? Math.round((bounced / sessions) * 1000) / 10 : 0,
    avgDurationSeconds: sessions > 0 ? Math.round(duration / sessions) : 0,
    activeVisitorsNow: 0,
  };
}

async function getOverviewMetricsRaw(
  request: MetricQueryRequest,
  params: Record<string, unknown>,
  filterClause: string,
  variant: "v1" | "v2" = "v1"
): Promise<OverviewMetricsResponse> {
  const client = readClient(variant);
  const engagementSet = await client.query({
    query: `
      SELECT
        uniqExact(visitor_pseudonym) AS visitors,
        count() AS sessions,
        sum(pageview_count) AS pageviews,
        round(countIf(NOT ${SESSION_ENGAGED_SQL}) / nullIf(count(), 0) * 100, 1) AS bounce_rate_percentage,
        round(avg(${SESSION_DURATION_SQL}), 0) AS avg_duration_seconds
      FROM (
        SELECT
          session_id,
          any(visitor_pseudonym) AS visitor_pseudonym,
          ${SESSION_ENGAGEMENT_COLUMNS}
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

/** The overview under ANALYTICS_READ: v1 legacy rollups, v2 aggregate tables, or both in shadow. */
export function getOverviewMetrics(request: MetricQueryRequest): Promise<OverviewMetricsResponse> {
  return dispatch(
    "getOverviewMetrics",
    (variant) => (variant === "v1" ? getOverviewMetricsV1(request) : getOverviewMetricsV2(request)),
    { normalize: ({ siteId: _s, dateRange: _d, ...numbers }) => numbers }
  );
}

const V2_EDGES = EDGES;

/**
 * v2 overview. Whole UTC days come from site_daily_agg (visitors, sessions, pageviews)
 * and session_day_agg (bounce, duration); only the two partial edge days read
 * events_v2. Short ranges and filtered requests read events_v2 directly: bounce and
 * duration need per-session rows, which the filter aggregate does not keep.
 *
 * session_day_agg has one row per session per day. Grouping by session alone across the
 * whole days rejoins a session that crossed midnight, so it counts once with its full
 * duration. Only a session straddling the edge of the whole-day window can count twice.
 */
async function getOverviewMetricsV2(request: MetricQueryRequest): Promise<OverviewMetricsResponse> {
  const client = getDashboardClickHouseClient();
  const filter = buildDimensionFilterSql(request.filters);
  const hours = rangeHours(request.dateRange.from, request.dateRange.to);
  const rawParams = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    ...filter.params,
  };
  const raw = () => getOverviewMetricsRaw(request, rawParams, filter.clause, "v2");

  if (request.filters) {
    // Bounce and duration need per-session rows, which only raw events have, so a filtered
    // range must stay small enough to scan.
    assertRawScanRange(request.dateRange.from, request.dateRange.to);
    return raw();
  }
  if (hours <= 48) return raw();
  const split = splitRange(request.dateRange.from, request.dateRange.to);
  if (!split.hasFullDays) return raw();

  const params: Params = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: rawParams.from,
    to: rawParams.to,
    headEnd: toClickHouseDateTime(split.headEnd),
    tailStart: toClickHouseDateTime(split.tailStart),
    fullFrom: split.fullFromDate,
    fullTo: split.fullToDate,
  };
  const TENANT_V2 = `workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}`;
  const run = async <T>(query: string) =>
    (await client.query({ query, query_params: params, format: "JSONEachRow" })).json<T>();

  let uniques: { visitors: string | number; sessions: string | number }[];
  let pageviews: { pageviews: string | number }[];
  let engagement: { part: string; sessions: string | number; bounced: string | number; duration: string | number }[];
  try {
    [uniques, pageviews, engagement] = await Promise.all([
      run<{ visitors: string | number; sessions: string | number }>(`
        SELECT uniqCombined64Merge(v) AS visitors, uniqCombined64Merge(s) AS sessions
        FROM (
          SELECT visitors AS v, sessions AS s FROM site_daily_agg
          WHERE ${TENANT_V2} AND ${FULL_DAYS}
          UNION ALL
          SELECT uniqCombined64State(visitor_hash) AS v, uniqCombined64State(session_hash) AS s
          FROM events_v2
          WHERE ${TENANT_V2} AND bot_status = 'human' AND ${V2_EDGES}
        )`),
      run<{ pageviews: string | number }>(`
        SELECT toUInt64(sum(p)) AS pageviews
        FROM (
          SELECT pageviews AS p FROM site_daily_agg WHERE ${TENANT_V2} AND ${FULL_DAYS}
          UNION ALL
          SELECT toUInt64(countIf(type = 'pageview')) AS p FROM events_v2
          WHERE ${TENANT_V2} AND bot_status = 'human' AND ${V2_EDGES}
        )`),
      run<{ part: string; sessions: string | number; bounced: string | number; duration: string | number }>(`
        SELECT 'rollup' AS part,
          toUInt64(count()) AS sessions,
          toUInt64(countIf(NOT (p >= 2 OR e >= 10000 OR a > 0))) AS bounced,
          toUInt64(sum(if(e > 0, toInt64(intDiv(e, 1000)), toInt64(dateDiff('second', f, l))))) AS duration
        FROM (
          SELECT session_hash, min(first_ts) AS f, max(last_ts) AS l, sum(pageviews) AS p,
                 sum(engaged_ms) AS e, sum(actions) AS a
          FROM session_day_agg
          WHERE site_id = {siteId:UUID} AND ${FULL_DAYS}
          GROUP BY session_hash
        )
        UNION ALL
        SELECT 'edge' AS part,
          toUInt64(count()) AS sessions,
          toUInt64(countIf(NOT ${SESSION_ENGAGED_SQL})) AS bounced,
          toUInt64(sum(${SESSION_DURATION_SQL})) AS duration
        FROM (
          SELECT ${SESSION_ENGAGEMENT_COLUMNS}
          FROM events_v2
          WHERE ${TENANT_V2} AND bot_status = 'human' AND ${V2_EDGES}
          GROUP BY session_hash, timestamp >= {tailStart:DateTime64}
        )`),
    ]);
  } catch (error) {
    console.warn("v2 overview failed on the aggregate tables, answering from events_v2:", error);
    return raw();
  }

  // Aggregates not populated for these days (before the backfill): answer from events_v2.
  const rollup = engagement.find((r) => r.part === "rollup");
  if (Number(rollup?.sessions || 0) === 0) return raw();

  const sum = (key: "sessions" | "bounced" | "duration") =>
    engagement.reduce((total, r) => total + Number(r[key] || 0), 0);
  const sessions = sum("sessions");
  return {
    siteId: request.siteId,
    dateRange: request.dateRange,
    visitors: Number(uniques[0]?.visitors || 0),
    sessions: Number(uniques[0]?.sessions || 0),
    pageviews: Number(pageviews[0]?.pageviews || 0),
    bounceRatePercentage: sessions > 0 ? Math.round((sum("bounced") / sessions) * 1000) / 10 : 0,
    avgDurationSeconds: sessions > 0 ? Math.round(sum("duration") / sessions) : 0,
    activeVisitorsNow: 0,
  };
}
