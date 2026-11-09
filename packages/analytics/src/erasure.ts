import type { ClickHouseClient } from "@clickhouse/client";
import { getClickHouseClient } from "./client.js";

/**
 * Erase one person's events from a site (GDPR Art. 17 / CCPA deletion).
 *
 * A person is `identifier` = their distinct id (stored in properties once identify() has run) or a
 * visitor pseudonym, the same rule getUserTimeline uses. The person's events are found first, then
 * every visitor pseudonym seen on them is collected and ALL events of those visitors are deleted, so
 * the anonymous page views from before identify() on the same browser go too. If two people shared one
 * browser, both lose the events recorded under it; that errs on the side of deleting.
 *
 * Every statement is scoped to {workspaceId, siteId} and every value is a bound parameter. The deletes
 * run site_profiles_agg -> identity_map -> error_occurrences -> error_events -> web_vitals -> events_v2 -> events_raw. The profile row (email, traits) goes first
 * and is deleted even when no events are found, so it can never be stranded. web_vitals rows carry no
 * visitor, so they are found through events_raw and must go before it; events_raw goes last so that a failure
 * part-way can simply be re-run (the visitors are still discoverable from whatever has not been deleted yet).
 *
 * Not erased, by design: the daily aggregate tables (counts and HyperLogLog states). They hold no
 * identifier and cannot be unpicked per person; they are anonymous statistics. Kafka and the dead-letter
 * topic keep a copy until their own retention expires.
 */
const TENANT = `workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}`;
const RAW_OF_VISITORS = `FROM events_raw WHERE ${TENANT} AND visitor_pseudonym IN {visitors:Array(String)}`;
/** v2 stores cityHash64(visitor_pseudonym); the explicit hashes cover a person that exists only in v2. */
const V2_OF_VISITORS = `visitor_hash IN (SELECT arrayJoin(arrayConcat(
  arrayMap(v -> cityHash64(v), {visitors:Array(String)}),
  arrayMap(h -> toUInt64(h), {hashes:Array(String)}))))`;

const PROFILE = `FROM site_profiles_agg WHERE ${TENANT} AND distinct_id = {id:String}`;
/** The visitor-to-user links (migration 015) for the person, by user id or by any of their visitor hashes. */
const IDENTITY = `FROM identity_map WHERE ${TENANT} AND (user_id = {id:String} OR ${V2_OF_VISITORS})`;
/** Error tracking (migration 016): events hold hashes of the user and visitor; occurrences hold the raw user id and the event id. */
const ERROR_EVENTS = `FROM error_events WHERE ${TENANT} AND (user_hash = cityHash64({id:String}) OR ${V2_OF_VISITORS})`;
const ERROR_OCCURRENCES = `FROM error_occurrences WHERE ${TENANT} AND (user_id = {id:String}
  OR event_id IN (SELECT event_id FROM events_v2 WHERE ${TENANT} AND type = 'error' AND ${V2_OF_VISITORS}))`;

export const ERASURE_SQL = {
  findVisitors: `SELECT DISTINCT visitor_pseudonym AS v FROM events_raw WHERE ${TENANT}
    AND (visitor_pseudonym = {id:String} OR JSONExtractString(properties_json, 'distinctId') = {id:String})`,
  findHashes: `SELECT DISTINCT toString(visitor_hash) AS h FROM events_v2 WHERE ${TENANT}
    AND (visitor_hash = cityHash64({id:String}) OR JSONExtractString(properties_json, 'distinctId') = {id:String})`,
  count: {
    site_profiles_agg: `SELECT count() AS n ${PROFILE}`,
    identity_map: `SELECT count() AS n ${IDENTITY}`,
    error_occurrences: `SELECT count() AS n ${ERROR_OCCURRENCES}`,
    error_events: `SELECT count() AS n ${ERROR_EVENTS}`,
    web_vitals: `SELECT count() AS n FROM web_vitals WHERE ${TENANT} AND event_id IN (SELECT event_id ${RAW_OF_VISITORS})`,
    events_v2: `SELECT count() AS n FROM events_v2 WHERE ${TENANT} AND ${V2_OF_VISITORS}`,
    events_raw: `SELECT count() AS n ${RAW_OF_VISITORS}`,
  },
  delete: {
    site_profiles_agg: `DELETE ${PROFILE}`,
    identity_map: `DELETE ${IDENTITY}`,
    error_occurrences: `DELETE ${ERROR_OCCURRENCES}`,
    error_events: `DELETE ${ERROR_EVENTS}`,
    web_vitals: `DELETE FROM web_vitals WHERE ${TENANT} AND event_id IN (SELECT event_id ${RAW_OF_VISITORS})`,
    events_v2: `DELETE FROM events_v2 WHERE ${TENANT} AND ${V2_OF_VISITORS}`,
    events_raw: `DELETE FROM events_raw WHERE ${TENANT} AND visitor_pseudonym IN {visitors:Array(String)}`,
  },
} as const;

/** Deletion order; see the note above. */
const ORDER = ["site_profiles_agg", "identity_map", "error_occurrences", "error_events", "web_vitals", "events_v2", "events_raw"] as const;

export interface ErasureTarget {
  workspaceId: string;
  siteId: string;
  /** A distinct id (from identify) or a visitor pseudonym. */
  identifier: string;
}

export interface ErasureResult {
  /** Visitor pseudonyms found for the person. */
  visitors: number;
  /** Rows matched (and, unless dryRun, deleted) per table. */
  rows: Record<(typeof ORDER)[number], number>;
  dryRun: boolean;
}

type Client = Pick<ClickHouseClient, "query" | "command">;

export async function eraseVisitor(
  target: ErasureTarget,
  options: { dryRun?: boolean } = {},
  client: Client = getClickHouseClient()
): Promise<ErasureResult> {
  const dryRun = options.dryRun ?? false;
  const tenant = { workspaceId: target.workspaceId, siteId: target.siteId };

  const column = async <T extends string>(query: string, key: T): Promise<string[]> => {
    const rs = await client.query({ query, query_params: { ...tenant, id: target.identifier }, format: "JSONEachRow" });
    return (await rs.json<Record<T, string>>()).map((row) => row[key]);
  };
  const visitors = await column(ERASURE_SQL.findVisitors, "v");
  const hashes = await column(ERASURE_SQL.findHashes, "h");
  const params = { ...tenant, id: target.identifier, visitors, hashes };

  // With no events found only the profile and identity steps apply; the event tables would match nothing anyway.
  const found = visitors.length > 0 || hashes.length > 0;
  const steps = ORDER.filter((table) => found || table === "site_profiles_agg" || table === "identity_map" || table === "error_occurrences" || table === "error_events");

  const rows = { site_profiles_agg: 0, identity_map: 0, error_occurrences: 0, error_events: 0, web_vitals: 0, events_v2: 0, events_raw: 0 };
  for (const table of steps) {
    const rs = await client.query({ query: ERASURE_SQL.count[table], query_params: params, format: "JSONEachRow" });
    rows[table] = Number((await rs.json<{ n: string }>())[0]?.n ?? 0);
  }
  if (!dryRun) {
    for (const table of steps) {
      await client.command({ query: ERASURE_SQL.delete[table], query_params: params });
    }
  }
  return { visitors: visitors.length, rows, dryRun };
}
