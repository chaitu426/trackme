import { readClient, variantAware, type ReadVariant } from "../read-mode.js";
import { AnalyticsQueryError } from "../errors.js";

export interface UserTimelineEvent {
  eventId: string;
  /** Groups events into visits; the v2 read path maps this to session_hash. */
  sessionId: string;
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

async function getUserTimelineImpl(params: {
  workspaceId: string;
  siteId: string;
  identifier: string; // distinctId or visitorPseudonym
  limit?: number;
},
  variant: ReadVariant): Promise<UserTimelineEvent[]> {
  try {
    const client = readClient(variant);
    const query = `
      SELECT
        toString(event_id) AS event_id,
        toString(session_id) AS session_id,
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
        AND type != 'engagement'
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
      session_id: string;
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
        sessionId: r.session_id,
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
    if (err instanceof AnalyticsQueryError) {
      throw err;
    }
    throw new AnalyticsQueryError("ClickHouse user timeline query failed", { cause: err });
  }
}

export const getUserTimeline = variantAware("getUserTimeline", getUserTimelineImpl, {
  normalize: (rows) => rows.map((r) => ({ ...r, country: r.country.trim() })),
});
