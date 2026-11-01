import { dispatch, readClient, type ReadVariant } from "../read-mode.js";

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
export function getRecentEvents(workspaceId: string, siteId: string, limit = 20): Promise<RecentEvent[]> {
  return dispatch("getRecentEvents", (variant) => getRecentEventsImpl(workspaceId, siteId, limit, variant), {
    // v1 stores an unknown country as two spaces, v2 as ''.
    normalize: (rows) => rows.map((r) => ({ ...r, country: r.country.trim() })),
  });
}

async function getRecentEventsImpl(
  workspaceId: string,
  siteId: string,
  limit: number,
  variant: ReadVariant
): Promise<RecentEvent[]> {
  const client = readClient(variant);

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
        AND type != 'engagement'
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
