import { MetricQueryRequest } from "@trackme/contracts";
import { getDashboardClickHouseClient } from "../client.js";
import { dispatch } from "../read-mode.js";
import { splitRange, toClickHouseDateTime } from "./range-split.js";

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
async function getWebVitalsSummaryV1(
  request: MetricQueryRequest
): Promise<WebVitalSummary[]> {
  const client = getDashboardClickHouseClient();

  const query = `
    SELECT
      metric_name AS metric,
      round(quantile(0.75)(metric_value), 2) AS p75,
      countIf(rating = 'good') AS good_count,
      countIf(rating = 'needs-improvement') AS needs_improvement_count,
      countIf(rating = 'poor') AS poor_count,
      count(*) AS total_samples
    FROM web_vitals FINAL
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


export function getWebVitalsSummary(request: MetricQueryRequest): Promise<WebVitalSummary[]> {
  return dispatch(
    "getWebVitalsSummary",
    (variant) => (variant === "v1" ? getWebVitalsSummaryV1(request) : getWebVitalsSummaryV2(request)),
    // t-digest p75 is approximate, and v1 also counted bot traffic.
    { tolerance: 0.1 }
  );
}

/**
 * v2: whole days merge the t-digest states in web_vitals_agg and the two edge days read
 * events_v2 (a range with no whole day reads events_v2 alone).
 */
async function getWebVitalsSummaryV2(request: MetricQueryRequest): Promise<WebVitalSummary[]> {
  const client = getDashboardClickHouseClient();
  const split = splitRange(request.dateRange.from, request.dateRange.to);
  const params: Record<string, unknown> = {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: request.dateRange.from.replace("T", " ").replace("Z", ""),
    to: request.dateRange.to.replace("T", " ").replace("Z", ""),
  };

  const rawPart = (window: string) => `
    SELECT vital_name AS metric,
      quantilesTDigestState(0.5, 0.75, 0.95)(vital_value) AS qs,
      toUInt64(count()) AS n,
      toUInt64(countIf(vital_rating = 'good')) AS good,
      toUInt64(countIf(vital_rating = 'needs-improvement')) AS needs,
      toUInt64(countIf(vital_rating = 'poor')) AS poor
    FROM events_v2
    WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}
      AND type = 'web_vital' AND bot_status = 'human' AND ${window}
    GROUP BY metric`;

  let source: string;
  if (split.hasFullDays) {
    params.headEnd = toClickHouseDateTime(split.headEnd);
    params.tailStart = toClickHouseDateTime(split.tailStart);
    params.fullFrom = split.fullFromDate;
    params.fullTo = split.fullToDate;
    source = `
      SELECT metric, q AS qs, samples AS n, good, needs, poor
      FROM web_vitals_agg
      WHERE site_id = {siteId:UUID} AND date >= {fullFrom:Date} AND date < {fullTo:Date}
      UNION ALL
      ${rawPart(`((timestamp >= {from:DateTime64} AND timestamp < {headEnd:DateTime64})
        OR (timestamp >= {tailStart:DateTime64} AND timestamp <= {to:DateTime64}))`)}`;
  } else {
    source = rawPart("timestamp >= {from:DateTime64} AND timestamp <= {to:DateTime64}");
  }

  const resultSet = await client.query({
    query: `
      SELECT metric,
        round(quantilesTDigestMerge(0.5, 0.75, 0.95)(qs)[2], 2) AS p75,
        sum(good) AS good_count,
        sum(needs) AS needs_improvement_count,
        sum(poor) AS poor_count,
        sum(n) AS total_samples
      FROM (${source})
      GROUP BY metric
      ORDER BY metric ASC`,
    query_params: params,
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
