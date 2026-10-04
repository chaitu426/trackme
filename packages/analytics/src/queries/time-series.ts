import { MetricQueryRequest } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";
import { buildDimensionFilterSql } from "./filters.js";

export interface TimeSeriesPoint {
  timestamp: string;
  visitors: number;
  sessions: number;
  pageviews: number;
}

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

function bucketExpression(granularity: MetricQueryRequest["dateRange"]["granularity"]): string {
  // Some existing TrackMe installations were initialized before `events_raw`
  // used DateTime64 and still have a String timestamp column. `toString` plus
  // best-effort parsing keeps the visual query compatible with both schemas.
  const eventTime = "parseDateTime64BestEffort(toString(timestamp), 3, 'UTC')";
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
export async function getTimeSeries(request: MetricQueryRequest): Promise<TimeSeriesPoint[]> {
  const client = getClickHouseClient();
  const filter = buildDimensionFilterSql(request.filters);
  const bucket = bucketExpression(request.dateRange.granularity);
  const resultSet = await client.query({
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
    query_params: {
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      from: toCH(request.dateRange.from),
      to: toCH(request.dateRange.to),
      ...filter.params,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    timestamp: string;
    visitors: string | number;
    sessions: string | number;
    pageviews: string | number;
  }>();

  return rows.map((row) => ({
    timestamp: row.timestamp,
    visitors: Number(row.visitors || 0),
    sessions: Number(row.sessions || 0),
    pageviews: Number(row.pageviews || 0),
  }));
}
