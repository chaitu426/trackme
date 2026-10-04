import { getClickHouseClient } from "../client.js";

export interface UserTimelineEvent {
  eventId: string;
  timestamp: string;
  type: string;
  eventName: string;
  path: string;
  url: string;
  title: string;
  referrer: string;
  browser: string;
  os: string;
  device: string;
  country: string;
  city: string;
  properties: Record<string, unknown>;
}

export async function getUserTimeline(params: {
  workspaceId: string;
  siteId: string;
  identifier: string; // distinctId or visitorPseudonym
  limit?: number;
}): Promise<UserTimelineEvent[]> {
  try {
    const client = getClickHouseClient();
    const query = `
      SELECT
        toString(event_id) AS event_id,
        formatDateTime(timestamp, '%Y-%m-%dT%H:%i:%SZ') AS timestamp,
        type,
        event_name,
        path,
        url,
        title,
        referrer,
        browser,
        os,
        device,
        country,
        city,
        properties_json
      FROM events_raw
      WHERE workspace_id = {workspaceId:UUID}
        AND site_id = {siteId:UUID}
        AND (
          visitor_pseudonym = {identifier:String}
          OR JSONExtractString(properties_json, 'distinctId') = {identifier:String}
        )
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
    `;

    const resultSet = await client.query({
      query,
      query_params: {
        workspaceId: params.workspaceId,
        siteId: params.siteId,
        identifier: params.identifier,
        limit: params.limit || 100,
      },
      format: "JSONEachRow",
    });

    const rows = await resultSet.json<{
      event_id: string;
      timestamp: string;
      type: string;
      event_name: string;
      path: string;
      url: string;
      title: string;
      referrer: string;
      browser: string;
      os: string;
      device: string;
      country: string;
      city: string;
      properties_json: string;
    }>();

    return rows.map((r) => {
      let props: Record<string, unknown> = {};
      try {
        props = JSON.parse(r.properties_json || "{}");
      } catch {
        // ignore
      }
      return {
        eventId: r.event_id,
        timestamp: r.timestamp,
        type: r.type,
        eventName: r.event_name,
        path: r.path,
        url: r.url,
        title: r.title,
        referrer: r.referrer,
        browser: r.browser,
        os: r.os,
        device: r.device,
        country: r.country,
        city: r.city,
        properties: props,
      };
    });
  } catch (err) {
    console.error("⚠️ [UserTimeline] ClickHouse query failed:", err);
    return [];
  }
}
