import { MetricQueryRequest } from "@trackme/contracts";
import { getClickHouseClient } from "../client.js";
import { buildDimensionFilterSql } from "./filters.js";

export interface JourneySummary {
  journey: string;
  sessions: number;
  visitors: number;
}

function toCH(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/** Top ordered page paths from privacy-safe, per-session event sequences. */
export async function getTopJourneys(request: MetricQueryRequest): Promise<JourneySummary[]> {
  const client = getClickHouseClient();
  const filter = buildDimensionFilterSql(request.filters);
  const resultSet = await client.query({
    query: `
      SELECT journey, count() AS sessions, uniqExact(visitor_pseudonym) AS visitors
      FROM (
        SELECT
          session_id,
          any(visitor_pseudonym) AS visitor_pseudonym,
          arrayStringConcat(
            arrayMap(
              point -> point.2,
              arraySlice(arraySort(point -> point.1, groupArray((timestamp, path))), 1, 5)
            ),
            ' → '
          ) AS journey
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
          AND timestamp >= {from:DateTime64}
          AND timestamp <= {to:DateTime64}
          AND bot_status = 'human'
          AND type = 'pageview'
          ${filter.clause}
        GROUP BY session_id
      )
      WHERE journey != ''
      GROUP BY journey
      ORDER BY sessions DESC, visitors DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      from: toCH(request.dateRange.from),
      to: toCH(request.dateRange.to),
      limit: request.limit ?? 20,
      ...filter.params,
    },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ journey: string; sessions: string | number; visitors: string | number }>();
  return rows.map((row) => ({ journey: row.journey, sessions: Number(row.sessions || 0), visitors: Number(row.visitors || 0) }));
}
