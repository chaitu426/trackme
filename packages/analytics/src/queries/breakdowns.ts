import { MetricQueryRequest, BreakdownResponse } from "@trackme/contracts";
import { getDashboardClickHouseClient } from "../client.js";
import { buildDimensionFilterSql } from "./filters.js";
import { dispatch, toV2Sql } from "../read-mode.js";
import { assertRawScanRange, splitRange, toClickHouseDateTime } from "./range-split.js";
import { CHANNEL_SQL } from "./channel-sql.js";

export type BreakdownDimension =
  | "path"
  | "referrer"
  | "channel"
  | "campaign_source"
  | "campaign_medium"
  | "campaign_name"
  | "country"
  | "city"
  | "browser"
  | "os"
  | "device";

const COLUMN_MAP: Record<BreakdownDimension, string> = {
  path: "path",
  referrer: "referrer",
  channel: CHANNEL_SQL,
  campaign_source: "campaign_source",
  campaign_medium: "campaign_medium",
  campaign_name: "campaign_name",
  country: "country",
  city: "city",
  browser: "browser",
  device: "device",
  os: "os",
};

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/**
 * Dimension breakdowns always use period-accurate `uniqExact` on events_raw.
 * Daily rollup `unique_visitors` must not be summed across days (overcounts
 * returning visitors). Pageviews remain a simple countIf.
 */
async function getBreakdownV1(
  request: MetricQueryRequest,
  dimension: BreakdownDimension
): Promise<BreakdownResponse> {
  const client = getDashboardClickHouseClient();
  const column = COLUMN_MAP[dimension];
  const filter = buildDimensionFilterSql(request.filters);

  const query = `
    SELECT
      ifNull(nullIf(${column}, ''), '(direct / none)') AS name,
      uniqExact(visitor_pseudonym) AS visitors,
      countIf(type = 'pageview') AS pageviews
    FROM events_raw
    WHERE workspace_id = {workspaceId:UUID}
      AND site_id = {siteId:UUID}
      AND timestamp >= {from:DateTime64}
      AND timestamp <= {to:DateTime64}
      AND bot_status = 'human' AND type = 'pageview'
      ${filter.clause}
    GROUP BY name
    ORDER BY visitors DESC, pageviews DESC
    LIMIT {limit:UInt32}
    OFFSET {offset:UInt32}
  `;

  const params = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    ...filter.params,
  };
  const [resultSet, totalSet] = await Promise.all([
    client.query({
      query,
      query_params: { ...params, limit: request.limit ?? 50, offset: request.offset ?? 0 },
      format: "JSONEachRow",
    }),
    client.query({
      query: `
        SELECT uniqExact(visitor_pseudonym) AS total
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= {from:DateTime64}
          AND timestamp <= {to:DateTime64}
          AND bot_status = 'human' AND type = 'pageview'
          ${filter.clause}
      `,
      query_params: params,
      format: "JSONEachRow",
    }),
  ]);

  const rows = await resultSet.json<{
    name: string;
    visitors: string | number;
    pageviews: string | number;
  }>();
  const total = Number((await totalSet.json<{ total: string | number }>())[0]?.total || 0);
  return shapeBreakdown(dimension, rows, total);
}

/**
 * Each row's share is of the site's unique visitors in the range, not of the rows returned,
 * so it stays true when the list is cut off at the limit. A visitor can appear in several
 * rows (two referrers, two pages), so the shares of one list may add up to more than 100%.
 */
function shapeBreakdown(
  dimension: BreakdownDimension,
  rows: { name: string; visitors: string | number; pageviews: string | number }[],
  total: number
): BreakdownResponse {
  return {
    dimension,
    total,
    items: rows.map((row) => {
      const visitors = Number(row.visitors || 0);
      return {
        name: row.name,
        visitors,
        pageviews: Number(row.pageviews || 0),
        percentage: total > 0 ? Math.min(100, Math.round((visitors / total) * 1000) / 10) : 0,
      };
    }),
  };
}

/** Rows with equal visitors have no defined order, so compare them by name. */
const sortedItems = (r: BreakdownResponse) => ({
  total: r.total,
  items: [...r.items].sort((a, b) => a.name.localeCompare(b.name)),
});

export function getBreakdown(request: MetricQueryRequest, dimension: BreakdownDimension): Promise<BreakdownResponse> {
  return dispatch(
    `getBreakdown:${dimension}`,
    (variant) => (variant === "v1" ? getBreakdownV1(request, dimension) : getBreakdownV2(request, dimension)),
    // v1 lists full referrer URLs and v2 lists their domains, so referrers cannot be compared.
    { normalize: (r) => (dimension === "referrer" ? { total: 0, items: [] } : sortedItems(r)) }
  );
}

/**
 * v2 breakdown. Long unfiltered ranges: whole days from dim_daily_agg plus the two edge
 * days from events_v2, merged as states so a visitor seen on several days counts once.
 * Long filtered ranges do the same from filter_daily_agg. Short ranges read events_v2.
 * The referrer dimension is the referrer domain.
 */
async function getBreakdownV2(request: MetricQueryRequest, dimension: BreakdownDimension): Promise<BreakdownResponse> {
  const client = getDashboardClickHouseClient();
  const column = dimension === "referrer" ? "referrer_domain" : COLUMN_MAP[dimension];
  // The aggregate tables have no channel or city dimension, so they read events_v2 directly.
  const rawOnly = dimension === "channel" || dimension === "city";
  if (rawOnly) assertRawScanRange(request.dateRange.from, request.dateRange.to);
  const filter = buildDimensionFilterSql(request.filters);
  const filterClause = toV2Sql(filter.clause);
  const hours = (new Date(request.dateRange.to).getTime() - new Date(request.dateRange.from).getTime()) / 3_600_000;
  const split = hours > 48 && !rawOnly ? splitRange(request.dateRange.from, request.dateRange.to) : null;

  const params: Record<string, unknown> = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    limit: request.limit ?? 50,
    offset: request.offset ?? 0,
    dim: dimension,
    ...filter.params,
  };
  const name = `ifNull(nullIf(toString(${column}), ''), '(direct / none)')`;
  const tail = `ORDER BY visitors DESC, pageviews DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

  let query: string;
  let totalQuery: string;
  const tenant = `workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}`;
  if (split?.hasFullDays) {
    params.headEnd = toClickHouseDateTime(split.headEnd);
    params.tailStart = toClickHouseDateTime(split.tailStart);
    params.fullFrom = split.fullFromDate;
    params.fullTo = split.fullToDate;
    const edges = `(
      (timestamp >= {from:DateTime64} AND timestamp < {headEnd:DateTime64})
      OR (timestamp >= {tailStart:DateTime64} AND timestamp <= {to:DateTime64})
    )`;
    const wholeDays = request.filters
      ? `SELECT ${name} AS name, visitors AS v, pageviews AS p
         FROM filter_daily_agg
         WHERE site_id = {siteId:UUID} AND date >= {fullFrom:Date} AND date < {fullTo:Date} ${filterClause}`
      : `SELECT ifNull(nullIf(value, ''), '(direct / none)') AS name, visitors AS v, pageviews AS p
         FROM dim_daily_agg
         WHERE site_id = {siteId:UUID} AND dim = {dim:String} AND date >= {fullFrom:Date} AND date < {fullTo:Date}`;
    query = `
      SELECT name, uniqCombined64Merge(v) AS visitors, sum(p) AS pageviews
      FROM (
        ${wholeDays}
        UNION ALL
        SELECT ${name} AS name, uniqCombined64State(visitor_hash) AS v, toUInt64(countIf(type = 'pageview')) AS p
        FROM events_v2
        WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}
          AND bot_status = 'human' AND type = 'pageview' AND ${edges} ${filterClause}
        GROUP BY name
      )
      GROUP BY name
      ${tail}`;
    totalQuery = `
      SELECT uniqCombined64Merge(v) AS total
      FROM (
        SELECT visitors AS v FROM ${request.filters ? "filter_daily_agg" : "site_daily_agg"}
        WHERE site_id = {siteId:UUID} AND date >= {fullFrom:Date} AND date < {fullTo:Date} ${request.filters ? filterClause : ""}
        UNION ALL
        SELECT uniqCombined64State(visitor_hash) AS v FROM events_v2
        WHERE ${tenant} AND bot_status = 'human' AND type = 'pageview' AND ${edges} ${filterClause}
      )`;
  } else {
    totalQuery = `
      SELECT uniqExact(visitor_hash) AS total FROM events_v2
      WHERE ${tenant} AND timestamp >= {from:DateTime64} AND timestamp <= {to:DateTime64}
        AND bot_status = 'human' AND type = 'pageview' ${filterClause}`;
    query = `
      SELECT ${name} AS name, uniqExact(visitor_hash) AS visitors, countIf(type = 'pageview') AS pageviews
      FROM events_v2
      WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}
        AND timestamp >= {from:DateTime64} AND timestamp <= {to:DateTime64}
        AND bot_status = 'human' AND type = 'pageview' ${filterClause}
      GROUP BY name
      ${tail}`;
  }

  const [resultSet, totalSet] = await Promise.all([
    client.query({ query, query_params: params, format: "JSONEachRow" }),
    client.query({ query: totalQuery, query_params: params, format: "JSONEachRow" }),
  ]);
  const total = Number((await totalSet.json<{ total: string | number }>())[0]?.total || 0);
  return shapeBreakdown(
    dimension,
    await resultSet.json<{ name: string; visitors: string | number; pageviews: string | number }>(),
    total
  );
}
