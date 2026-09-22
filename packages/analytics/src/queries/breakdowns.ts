import { MetricQueryRequest, BreakdownResponse } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";
import { buildDimensionFilterSql } from "./filters.js";

export type BreakdownDimension =
  | "path"
  | "referrer"
  | "campaign_source"
  | "campaign_medium"
  | "campaign_name"
  | "country"
  | "browser"
  | "os"
  | "device";

const COLUMN_MAP: Record<BreakdownDimension, string> = {
  path: "path",
  referrer: "referrer",
  campaign_source: "campaign_source",
  campaign_medium: "campaign_medium",
  campaign_name: "campaign_name",
  country: "country",
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
export async function getBreakdown(
  request: MetricQueryRequest,
  dimension: BreakdownDimension
): Promise<BreakdownResponse> {
  const client = getClickHouseClient();
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
      AND bot_status = 'human'
      ${filter.clause}
    GROUP BY name
    ORDER BY visitors DESC, pageviews DESC
    LIMIT {limit:UInt32}
    OFFSET {offset:UInt32}
  `;

  const resultSet = await client.query({
    query,
    query_params: {
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      from: toCH(request.dateRange.from),
      to: toCH(request.dateRange.to),
      limit: request.limit ?? 50,
      offset: request.offset ?? 0,
      ...filter.params,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    name: string;
    visitors: string | number;
    pageviews: string | number;
  }>();

  const totalVisitors = rows.reduce((acc, row) => acc + Number(row.visitors || 0), 0);

  const items = rows.map((row) => {
    const visitors = Number(row.visitors || 0);
    const percentage = totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 1000) / 10 : 0;
    return {
      name: row.name,
      visitors,
      pageviews: Number(row.pageviews || 0),
      percentage,
    };
  });

  return {
    dimension,
    total: totalVisitors,
    items,
  };
}
