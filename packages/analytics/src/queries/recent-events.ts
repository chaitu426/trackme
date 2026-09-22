import { getClickHouseClient } from "../client.js";

export type RecentEvent = {
  eventId: string;
  type: string;
  eventName: string;
  path: string;
  country: string;
  browser: string;
  os: string;
  occurredAt: string;
};

/**
 * Fetch the most recently received events for a site, used to render a live
 * activity tail. Ordered by ingestion time (received_at) rather than the
 * client-reported occurredAt, since clocks on the client are untrusted.
 */
export async function getRecentEvents(
  workspaceId: string,
  siteId: string,
  limit = 20
): Promise<RecentEvent[]> {
  const client = getClickHouseClient();

  const resultSet = await client.query({
    query: `
      SELECT
        event_id,
        type,
        event_name,
        path,
        country,
        browser,
        os,
        timestamp
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND bot_status = 'human'
      ORDER BY received_at DESC
      LIMIT {limit:UInt32}
    `,
    query_params: { workspaceId, siteId, limit },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    event_id: string;
    type: string;
    event_name: string;
    path: string;
    country: string;
    browser: string;
    os: string;
    timestamp: string;
  }>();

  return rows.map((row) => ({
    eventId: row.event_id,
    type: row.type,
    eventName: row.event_name,
    path: row.path,
    country: row.country,
    browser: row.browser,
    os: row.os,
    occurredAt: row.timestamp,
  }));
}
