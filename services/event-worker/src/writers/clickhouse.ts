import { EnrichedEvent } from "@trackme/contracts";
import { DataError } from "../errors.js";

/**
 * ClickHouse JSONEachRow DateTime64 parsing rejects the trailing `Z` on ISO
 * strings. Convert to `YYYY-MM-DD HH:MM:SS.mmm` (UTC) before insert.
 */
function toClickHouseDateTime64(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new DataError(`Invalid timestamp for ClickHouse insert: ${iso}`);
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

type Settings = Record<string, string | number>;

/** The part of the ClickHouse client the writer uses, so tests can supply a fake. */
export interface InsertClient {
  insert(params: {
    table: string;
    values: unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Settings;
  }): Promise<unknown>;
}

export interface WriterOptions {
  client: InsertClient;
  /**
   * Let ClickHouse merge many small inserts into larger parts. The worker still
   * waits for the flush (wait_for_async_insert), so an offset is only resolved
   * once the rows are durable.
   */
  asyncInsert: boolean;
  flushIntervalMs: number;
}

export function insertSettings(options: Pick<WriterOptions, "asyncInsert" | "flushIntervalMs">): Settings | undefined {
  if (!options.asyncInsert) return undefined;
  return {
    async_insert: 1,
    wait_for_async_insert: 1,
    async_insert_busy_timeout_ms: options.flushIntervalMs,
  };
}

/**
 * Build the function that inserts enriched events into events_raw and, for web
 * vitals, web_vitals. Both tables dedupe on event_id, so redelivering a batch
 * after a partial failure does not create duplicates.
 */
export function createClickHouseWriter(options: WriterOptions): (events: EnrichedEvent[]) => Promise<void> {
  const { client } = options;
  const clickhouse_settings = insertSettings(options);
  const withSettings = clickhouse_settings ? { clickhouse_settings } : {};

  return async (events) => {
    if (events.length === 0) return;

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
      ...withSettings,
    });

    // Extract Web Vitals if present
    const vitalsRows = events
      .filter((e) => e.type === "web_vital" && e.webVital)
      .map((e) => ({
        event_id: e.eventId,
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
        ...withSettings,
      });
    }
  };
}

