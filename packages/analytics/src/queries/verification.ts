import { getClickHouseClient } from "../client.js";

export type FirstEventStatus = {
  received: boolean;
  firstEventAt: string | null;
  totalEvents: number;
};

/**
 * Checks whether a freshly onboarded site has received any events yet, so
 * the onboarding flow can confirm installation instead of assuming success.
 */
export async function getFirstEventStatus(
  workspaceId: string,
  siteId: string
): Promise<FirstEventStatus> {
  const client = getClickHouseClient();

  const resultSet = await client.query({
    query: `
      SELECT
        count() AS total_events,
        min(timestamp) AS first_event_at
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
    `,
    query_params: { workspaceId, siteId },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{
    total_events: string | number;
    first_event_at: string | null;
  }>();

  const row = rows[0];
  const totalEvents = Number(row?.total_events ?? 0);

  return {
    received: totalEvents > 0,
    firstEventAt: totalEvents > 0 ? row?.first_event_at ?? null : null,
    totalEvents,
  };
}
