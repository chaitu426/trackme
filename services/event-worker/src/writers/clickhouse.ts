import { getClickHouseClient } from "@trackme/analytics";
import { EnrichedEvent } from "@trackme/contracts";

/**
 * ClickHouse JSONEachRow DateTime64 parsing rejects the trailing `Z` on ISO
 * strings. Convert to `YYYY-MM-DD HH:MM:SS.mmm` (UTC) before insert.
 */
function toClickHouseDateTime64(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp for ClickHouse insert: ${iso}`);
  }
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}

/**
 * FixedString(2) rejects a zero-length JSON string; use a 2-char placeholder.
 */
function toCountryCode(country: string | undefined): string {
  if (!country || country.length !== 2) return "  ";
  return country.toUpperCase();
}

/**
 * Batch insert enriched events into ClickHouse events_raw
 */
export async function writeEventsToClickHouse(events: EnrichedEvent[]): Promise<void> {
  if (events.length === 0) return;

  const client = getClickHouseClient();

  const rawRows = events.map((e) => ({
    event_id: e.eventId,
    schema_version: e.schemaVersion,
    workspace_id: e.workspaceId,
    site_id: e.siteId,
    site_key: e.siteKey,
    timestamp: toClickHouseDateTime64(e.occurredAt),
    received_at: toClickHouseDateTime64(e.receivedAt),
    type: e.type,
    event_name: e.type === "custom" && e.properties?.eventName ? String(e.properties.eventName) : e.type,
    session_id: e.sessionId,
    visitor_pseudonym: e.visitorPseudonym,
    url: e.url,
    path: e.path,
    title: e.title || "",
    referrer: e.referrer || "",
    campaign_source: e.campaign?.source || "",
    campaign_medium: e.campaign?.medium || "",
    campaign_name: e.campaign?.campaign || "",
    campaign_term: e.campaign?.term || "",
    campaign_content: e.campaign?.content || "",
    country: toCountryCode(e.country),
    city: e.city || "",
    browser: e.browser || "",
    os: e.os || "",
    device: e.device || "desktop",
    bot_status: e.botStatus || "human",
    properties_json: e.properties ? JSON.stringify(e.properties) : "{}",
  }));

  await client.insert({
    table: "events_raw",
    values: rawRows,
    format: "JSONEachRow",
  });

  // Extract Web Vitals if present
  const vitalsRows = events
    .filter((e) => e.type === "web_vital" && e.webVital)
    .map((e) => ({
      workspace_id: e.workspaceId,
      site_id: e.siteId,
      timestamp: toClickHouseDateTime64(e.occurredAt),
      path: e.path,
      metric_name: e.webVital!.name,
      metric_value: e.webVital!.value,
      rating: e.webVital!.rating,
      navigation_type: e.webVital!.navigationType || "navigate",
    }));

  if (vitalsRows.length > 0) {
    await client.insert({
      table: "web_vitals",
      values: vitalsRows,
      format: "JSONEachRow",
    });
  }
}

