import { MetricQueryRequest } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";
import { buildDimensionFilterSql } from "./filters.js";

export type CampaignBreakdownItem = {
  campaign: string;
  source: string;
  medium: string;
  visitors: number;
  pageviews: number;
};

export type CampaignBreakdownResponse = {
  total: number;
  items: CampaignBreakdownItem[];
};

/**
 * Groups traffic by UTM campaign (campaign name + source + medium), unlike
 * getBreakdown which only groups by a single dimension. Excludes traffic
 * with no campaign attached.
 */
export async function getCampaignBreakdown(
  request: MetricQueryRequest
): Promise<CampaignBreakdownResponse> {
  const client = getClickHouseClient();
  const filter = buildDimensionFilterSql(request.filters);

  const resultSet = await client.query({
    query: `
      SELECT
        campaign_name,
        campaign_source,
        campaign_medium,
        uniqExact(visitor_pseudonym) AS visitors,
        countIf(type = 'pageview') AS pageviews
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND timestamp >= {from:DateTime64}
        AND timestamp <= {to:DateTime64}
        AND bot_status = 'human'
        AND campaign_name != ''
        ${filter.clause}
      GROUP BY campaign_name, campaign_source, campaign_medium
      ORDER BY visitors DESC, pageviews DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `,
    query_params: {
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      from: request.dateRange.from.replace('T', ' ').replace('Z', ''),
      to: request.dateRange.to.replace('T', ' ').replace('Z', ''),
      limit: request.limit ?? 50,
      offset: request.offset ?? 0,
      ...filter.params,
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    campaign_name: string;
    campaign_source: string;
    campaign_medium: string;
    visitors: string | number;
    pageviews: string | number;
  }>();

  const items = rows.map((row) => ({
    campaign: row.campaign_name,
    source: row.campaign_source,
    medium: row.campaign_medium,
    visitors: Number(row.visitors || 0),
    pageviews: Number(row.pageviews || 0),
  }));

  return {
    total: items.reduce((acc, item) => acc + item.visitors, 0),
    items,
  };
}
