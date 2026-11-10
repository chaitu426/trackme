import { MetricQueryRequest } from "@trackme/contracts";
import { readClient, variantAware, type ReadVariant } from "../read-mode.js";
import { AnalyticsQueryError } from "../errors.js";
import { assertRawScanRange } from "./range-split.js";
import { SESSION_ENGAGED_SQL, SESSION_ENGAGEMENT_COLUMNS } from "./engagement-sql.js";

/**
 * Per-page reports that need session context, so they read event-level rows (bounded by
 * assertRawScanRange). Queries are written against events_raw; readClient rewrites them for v2.
 */

const toCH = (iso: string) => iso.replace("T", " ").replace("Z", "");

function baseParams(request: MetricQueryRequest, extra: Record<string, unknown> = {}) {
  return {
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    from: toCH(request.dateRange.from),
    to: toCH(request.dateRange.to),
    ...extra,
  };
}

const TENANT = `workspace_id = {workspaceId:UUID}
  AND site_id = {siteId:UUID}
  AND timestamp >= {from:DateTime64}
  AND timestamp <= {to:DateTime64}
  AND bot_status = 'human'`;

/* ───────────────────────────── Page engagement ───────────────────────────── */

export interface PageEngagementRow {
  path: string;
  pageviews: number;
  visitors: number;
  /** Average seconds the page was visible and in use, over views that reported it; null when none did. */
  avgActiveSeconds: number | null;
  /** Sessions that began on this page. */
  entrances: number;
  /** Share of those sessions that were not engaged (see engagement-sql). Null with no entrances. */
  bounceRate: number | null;
  /** Share of this page's views that were the last page of their session. */
  exitRate: number | null;
}

async function pageEngagementImpl(
  request: MetricQueryRequest,
  limit: number,
  variant: ReadVariant
): Promise<PageEngagementRow[]> {
  assertRawScanRange(request.dateRange.from, request.dateRange.to);
  const client = readClient(variant);
  const params = baseParams(request, { limit });
  const run = async <T>(query: string, query_params: Record<string, unknown>) => {
    const rs = await client.query({ query, query_params, format: "JSONEachRow" });
    return rs.json<T>();
  };

  const ms = `JSONExtractUInt(properties_json, 'engagementMs')`;
  const perSession = `
    SELECT session_id,
           argMinIf(path, timestamp, type = 'pageview') AS entry_path,
           argMaxIf(path, timestamp, type = 'pageview') AS exit_path,
           ${SESSION_ENGAGEMENT_COLUMNS}
    FROM events_raw
    WHERE ${TENANT}
    GROUP BY session_id
    HAVING pageview_count > 0`;

  try {
    const pages = await run<{
      path: string;
      pageviews: string | number;
      visitors: string | number;
      avg_ms: string | number | null;
    }>(
      `SELECT path,
              countIf(type = 'pageview') AS pageviews,
              uniqExactIf(visitor_pseudonym, type = 'pageview') AS visitors,
              avgIf(${ms}, type = 'engagement' AND ${ms} > 0) AS avg_ms
       FROM events_raw
       WHERE ${TENANT} AND type IN ('pageview', 'engagement')
       GROUP BY path
       HAVING pageviews > 0
       ORDER BY pageviews DESC, path ASC
       LIMIT {limit:UInt32}`,
      params
    );
    if (pages.length === 0) return [];

    const [entries, exits] = await Promise.all([
      run<{ path: string; entrances: string | number; bounces: string | number }>(
        `SELECT entry_path AS path, count() AS entrances, countIf(NOT ${SESSION_ENGAGED_SQL}) AS bounces
         FROM (${perSession}) GROUP BY entry_path`,
        params
      ),
      run<{ path: string; exits: string | number }>(
        `SELECT exit_path AS path, count() AS exits FROM (${perSession}) GROUP BY exit_path`,
        params
      ),
    ]);

    const entryBy = new Map(entries.map((r) => [r.path, r]));
    const exitBy = new Map(exits.map((r) => [r.path, Number(r.exits)]));

    return pages.map((p) => {
      const pageviews = Number(p.pageviews);
      const entry = entryBy.get(p.path);
      const entrances = Number(entry?.entrances ?? 0);
      const avgMs = p.avg_ms === null ? NaN : Number(p.avg_ms);
      return {
        path: p.path,
        pageviews,
        visitors: Number(p.visitors),
        avgActiveSeconds: Number.isFinite(avgMs) && avgMs > 0 ? Math.round(avgMs / 100) / 10 : null,
        entrances,
        bounceRate: entrances > 0 ? Math.round((Number(entry?.bounces ?? 0) / entrances) * 1000) / 10 : null,
        exitRate:
          pageviews > 0 ? Math.min(100, Math.round(((exitBy.get(p.path) ?? 0) / pageviews) * 1000) / 10) : null,
      };
    });
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse page engagement query failed", { cause: err });
  }
}

export const getPageEngagement = variantAware("getPageEngagement", pageEngagementImpl, {
  tolerance: 0.1,
  normalize: (rows) => [...rows].sort((a, b) => a.path.localeCompare(b.path)),
});

/* ───────────────────────────── Web Vitals by page ───────────────────────────── */

export interface PageVitalRow {
  path: string;
  metric: string;
  p75: number;
  samples: number;
  goodCount: number;
  needsImprovementCount: number;
  poorCount: number;
}

async function vitalsByPageImpl(request: MetricQueryRequest, limit: number, variant: ReadVariant): Promise<PageVitalRow[]> {
  assertRawScanRange(request.dateRange.from, request.dateRange.to);
  const client = readClient(variant);
  // v1 keeps vitals in their own table; v2 keeps them as events_v2 rows of type web_vital.
  const source =
    variant === "v1"
      ? `SELECT path, metric_name AS metric, metric_value AS value, rating
         FROM web_vitals FINAL
         WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}
           AND timestamp >= {from:DateTime64} AND timestamp <= {to:DateTime64}`
      : `SELECT path, vital_name AS metric, vital_value AS value, vital_rating AS rating
         FROM events_v2
         WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}
           AND type = 'web_vital' AND bot_status = 'human'
           AND timestamp >= {from:DateTime64} AND timestamp <= {to:DateTime64}`;

  try {
    const rs = await client.query({
      query: `
        SELECT path, metric,
               round(quantile(0.75)(value), 3) AS p75,
               count() AS samples,
               countIf(rating = 'good') AS good,
               countIf(rating = 'needs-improvement') AS needs,
               countIf(rating = 'poor') AS poor
        FROM (${source})
        WHERE path != ''
        GROUP BY path, metric
        ORDER BY samples DESC, path ASC, metric ASC
        LIMIT {limit:UInt32}`,
      query_params: baseParams(request, { limit }),
      format: "JSONEachRow",
    });
    const rows = await rs.json<{
      path: string;
      metric: string;
      p75: string | number;
      samples: string | number;
      good: string | number;
      needs: string | number;
      poor: string | number;
    }>();
    return rows.map((r) => ({
      path: r.path,
      metric: r.metric.toUpperCase(),
      p75: Number(r.p75 || 0),
      samples: Number(r.samples || 0),
      goodCount: Number(r.good || 0),
      needsImprovementCount: Number(r.needs || 0),
      poorCount: Number(r.poor || 0),
    }));
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse vitals-by-page query failed", { cause: err });
  }
}

export const getWebVitalsByPage = variantAware("getWebVitalsByPage", vitalsByPageImpl, {
  tolerance: 0.1,
  normalize: (rows) => [...rows].sort((a, b) => (a.path + a.metric).localeCompare(b.path + b.metric)),
});
