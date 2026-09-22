import { MetricQueryRequest } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";

export interface WebVitalSummary {
  metric: string;
  p75: number;
  goodCount: number;
  needsImprovementCount: number;
  poorCount: number;
  totalSamples: number;
}

/**
 * Calculate p75 Web Vitals percentiles (LCP, CLS, INP, FCP, TTFB)
 */
export async function getWebVitalsSummary(
  request: MetricQueryRequest
): Promise<WebVitalSummary[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      metric_name AS metric,
      round(quantile(0.75)(metric_value), 2) AS p75,
      countIf(rating = 'good') AS good_count,
      countIf(rating = 'needs-improvement') AS needs_improvement_count,
      countIf(rating = 'poor') AS poor_count,
      count(*) AS total_samples
    FROM web_vitals
    WHERE workspace_id = {workspaceId:UUID}
      AND site_id = {siteId:UUID}
      AND timestamp >= {from:DateTime64}
      AND timestamp <= {to:DateTime64}
    GROUP BY metric_name
    ORDER BY metric_name ASC
  `;

  const resultSet = await client.query({
    query,
    query_params: {
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      from: request.dateRange.from.replace('T', ' ').replace('Z', ''),
      to: request.dateRange.to.replace('T', ' ').replace('Z', ''),
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    metric: string;
    p75: string | number;
    good_count: string | number;
    needs_improvement_count: string | number;
    poor_count: string | number;
    total_samples: string | number;
  }>();

  return rows.map((row) => ({
    metric: row.metric,
    p75: Number(row.p75 || 0),
    goodCount: Number(row.good_count || 0),
    needsImprovementCount: Number(row.needs_improvement_count || 0),
    poorCount: Number(row.poor_count || 0),
    totalSamples: Number(row.total_samples || 0),
  }));
}

