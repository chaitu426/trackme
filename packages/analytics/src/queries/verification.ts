import { readClient, variantAware, type ReadVariant } from "../read-mode.js";

/** `totalEvents` never reports more than this: "1000" means "at least 1000". */
export const FIRST_EVENT_SCAN_CAP = 1000;

export type FirstEventStatus = {
  received: boolean;
  firstEventAt: string | null;
  totalEvents: number;
};

/**
 * Checks whether a freshly onboarded site has received any events yet, so
 * the onboarding flow can confirm installation instead of assuming success.
 */
async function getFirstEventStatusImpl(
  workspaceId: string,
  siteId: string
,
  variant: ReadVariant): Promise<FirstEventStatus> {
  const client = readClient(variant);

  // The onboarding page polls this until the first event lands. Counting every row the site has ever
  // sent made each poll scan its whole history. Read at most FIRST_EVENT_SCAN_CAP rows from the start of
  // the sort key (workspace, site, date) instead: "received" is exact, `totalEvents` saturates at the
  // cap, and `firstEventAt` is exact unless the first day alone holds more rows than the cap.
  const resultSet = await client.query({
    query: `
      SELECT
        count() AS total_events,
        min(timestamp) AS first_event_at
      FROM (
        SELECT timestamp
        FROM events_raw
        WHERE workspace_id = {workspaceId:UUID}
          AND site_id = {siteId:UUID}
        ORDER BY toDate(timestamp)
        LIMIT ${FIRST_EVENT_SCAN_CAP}
      )
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

export const getFirstEventStatus = variantAware("getFirstEventStatus", getFirstEventStatusImpl);
