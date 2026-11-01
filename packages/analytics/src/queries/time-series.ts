import { MetricQueryRequest } from "@trackme/contracts";
import { readClient, variantAware, type ReadVariant } from "../read-mode.js";
import { buildDimensionFilterSql } from "./filters.js";
import { SESSION_DURATION_SQL, SESSION_ENGAGED_SQL, SESSION_ENGAGEMENT_COLUMNS } from "./engagement-sql.js";

export interface TimeSeriesPoint {
  timestamp: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  /** % of sessions that started in this bucket and viewed a single page. */
  bounceRate: number;
  /** Mean session length, in seconds, for sessions that started in this bucket. */
  avgDuration: number;
}

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

function bucketExpression(
  granularity: MetricQueryRequest["dateRange"]["granularity"],
  timestampExpr = "timestamp"
): string {
  // Some existing TrackMe installations were initialized before `events_raw`
  // used DateTime64 and still have a String timestamp column. `toString` plus
  // best-effort parsing keeps the visual query compatible with both schemas.
  const eventTime = `parseDateTime64BestEffort(toString(${timestampExpr}), 3, 'UTC')`;
  const buckets = {
    minute: `toStartOfMinute(${eventTime})`,
    hour: `toStartOfHour(${eventTime})`,
    day: `toStartOfDay(${eventTime})`,
    month: `toStartOfMonth(${eventTime})`,
  } as const;
  return buckets[granularity];
}

/**
 * A filter-aware series for visual reports. Period visitors are unique inside
 * each bucket, so callers must not sum this field to calculate period uniques.
 */
async function getTimeSeriesImpl(request: MetricQueryRequest, variant: ReadVariant): Promise<TimeSeriesPoint[]> {
  const client = readClient(variant);
  const filter = buildDimensionFilterSql(request.filters);
  const bucket = bucketExpression(request.dateRange.granularity);
  const startBucket = bucketExpression(request.dateRange.granularity, "session_start");
  const queryParams = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    ...filter.params,
  };

  const [trafficSet, engagementSet] = await Promise.all([
    client.query({
      query: `
      SELECT
        formatDateTime(bucket, '%Y-%m-%dT%H:%i:%SZ') AS timestamp,
        uniqExact(visitor_pseudonym) AS visitors,
        uniqExact(session_id) AS sessions,
        countIf(type = 'pageview') AS pageviews
      FROM (
        SELECT
          ${bucket} AS bucket,
          visitor_pseudonym,
          session_id,
          type
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= {from:DateTime64}
          AND timestamp <= {to:DateTime64}
          AND bot_status = 'human'
          ${filter.clause}
      )
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
      query_params: queryParams,
      format: "JSONEachRow",
    }),
    // Bounce and duration are per-session, so each session counts once, in the bucket it started.
    client.query({
      query: `
      SELECT
        formatDateTime(bucket, '%Y-%m-%dT%H:%i:%SZ') AS timestamp,
        round(countIf(NOT ${SESSION_ENGAGED_SQL}) / nullIf(count(), 0) * 100, 1) AS bounce_rate,
        round(avg(${SESSION_DURATION_SQL}), 0) AS avg_duration
      FROM (
        SELECT
          ${startBucket} AS bucket,
          pageview_count, engaged_ms, action_count, span_seconds
        FROM (
          SELECT
            session_id,
            min(timestamp) AS session_start,
            ${SESSION_ENGAGEMENT_COLUMNS}
          FROM events_raw
          WHERE workspace_id = {workspaceId:UUID}
            AND site_id = {siteId:UUID}
            AND timestamp >= {from:DateTime64}
            AND timestamp <= {to:DateTime64}
            AND bot_status = 'human'
            ${filter.clause}
          GROUP BY session_id
        )
      )
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
      query_params: queryParams,
      format: "JSONEachRow",
    }),
  ]);

  const rows = await trafficSet.json<{
    timestamp: string;
    visitors: string | number;
    sessions: string | number;
    pageviews: string | number;
  }>();
  const engagementRows = await engagementSet.json<{
    timestamp: string;
    bounce_rate: string | number | null;
    avg_duration: string | number | null;
  }>();
  const engagement = new Map(engagementRows.map((row) => [row.timestamp, row]));

  return rows.map((row) => {
    const e = engagement.get(row.timestamp);
    return {
      timestamp: row.timestamp,
      visitors: Number(row.visitors || 0),
      sessions: Number(row.sessions || 0),
      pageviews: Number(row.pageviews || 0),
      bounceRate: Number(e?.bounce_rate || 0),
      avgDuration: Number(e?.avg_duration || 0),
    };
  });
}

export const getTimeSeries = variantAware("getTimeSeries", getTimeSeriesImpl);
