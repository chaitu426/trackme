import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";

/**
 * User 360: one person's activity as a single chronological stream (migration 018, 90 days).
 *
 * Query plan: user_timeline is ordered (site_id, user_id, ts, event_id), so a page of one person's history is a
 * contiguous range of the primary key read newest first: rows scanned = the page size plus the granules it touches,
 * independent of how many events the site has. Keyset pagination on (ts, event_id); no OFFSET.
 * Every query binds {siteId}. Callers must have authorized the site for the workspace first.
 */

type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

export interface TimelineItem {
  eventId: string;
  /** ISO timestamp, UTC. */
  at: string;
  /** page | event | error today; later features add kinds. */
  kind: string;
  summary: string;
  severity: "info" | "warning" | "error";
  /** What the row links to: an issue id for errors, a path for pages. */
  ref: string;
  /** Rows with the same value were in the same session. Opaque; only compare for equality. */
  sessionKey: string;
  release: string;
}

export interface TimelineQuery {
  siteId: string;
  userId: string;
  kinds?: string[] | undefined;
  severities?: string[] | undefined;
  cursor?: string | undefined;
  limit: number;
}

const CURSOR = /^(\d{10,16}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SHORT = /^[a-z_]{1,24}$/;

export function parseTimelineCursor(cursor: string | undefined): { ms: string; eventId: string } | null {
  const match = CURSOR.exec(cursor ?? "");
  return match ? { ms: match[1]!, eventId: match[2]! } : null;
}

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse user timeline query failed", { cause: err });
  }
}

interface RawItem {
  eid: string;
  ms: string | number;
  kind: string;
  summary: string;
  sev: string;
  ref: string;
  sess: string;
  rel: string;
}

const toItem = (r: RawItem): TimelineItem => ({
  eventId: r.eid,
  at: new Date(Number(r.ms)).toISOString(),
  kind: r.kind,
  summary: r.summary,
  severity: r.sev === "error" || r.sev === "warning" ? r.sev : "info",
  ref: r.ref,
  sessionKey: r.sess,
  release: r.rel,
});

/** A page of one person's history, newest first. Asks for one extra row to know whether another page exists. */
export async function getUserTimelinePage(
  q: TimelineQuery,
  client: Client = getDashboardClickHouseClient()
): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
  const params: Params = { siteId: q.siteId, userId: q.userId, limit: q.limit + 1 };
  const where: string[] = [];
  const kinds = (q.kinds ?? []).filter((k) => SHORT.test(k));
  if (kinds.length > 0) {
    where.push("AND kind IN {kinds:Array(String)}");
    params.kinds = kinds;
  }
  const severities = (q.severities ?? []).filter((s) => SHORT.test(s));
  if (severities.length > 0) {
    where.push("AND severity IN {severities:Array(String)}");
    params.severities = severities;
  }
  const cursor = parseTimelineCursor(q.cursor);
  if (cursor) {
    where.push("AND (ts, event_id) < (fromUnixTimestamp64Milli({cursorMs:Int64}, 'UTC'), toUUID({cursorId:String}))");
    params.cursorMs = cursor.ms;
    params.cursorId = cursor.eventId;
  }

  const rows = await run<RawItem>(
    client,
    `SELECT toString(event_id) AS eid, toUnixTimestamp64Milli(ts) AS ms, kind, summary,
            severity AS sev, ref, toString(session_hash) AS sess, release AS rel
     FROM user_timeline
     WHERE site_id = {siteId:UUID} AND user_id = {userId:String} ${where.join(" ")}
     ORDER BY ts DESC, event_id DESC
     LIMIT {limit:UInt32}`,
    params
  );

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    nextCursor: rows.length > q.limit && last ? `${last.ms}:${last.eid}` : null,
  };
}

export interface UserSummary {
  /** First day ever seen (exact, kept 25 months); null when the user has no recorded activity. */
  firstSeen: string | null;
  /** Everything below covers the last 90 days, the timeline's retention. */
  lastSeen: string | null;
  sessions: number;
  pages: number;
  events: number;
  errors: number;
  release: string;
  country: string;
  device: string;
  lastError: { eventId: string; at: string; summary: string; ref: string } | null;
}

/** The header of a person's page: counts over the retained window, where they last were, and their latest error. */
export async function getUserSummary(
  siteId: string,
  userId: string,
  client: Client = getDashboardClickHouseClient()
): Promise<UserSummary> {
  const [totals, first, error] = await Promise.all([
    run<{
      sessions: string; pages: string; events: string; errors: string; last_ms: string;
      rel: string; ctry: string; dev: string; n: string;
    }>(
      client,
      `SELECT count() AS n, uniqExact(session_hash) AS sessions, countIf(kind = 'page') AS pages,
              countIf(kind = 'event') AS events, countIf(kind = 'error') AS errors,
              toUnixTimestamp64Milli(max(ts)) AS last_ms,
              argMax(release, ts) AS rel, argMax(country, ts) AS ctry, argMax(device, ts) AS dev
       FROM user_timeline WHERE site_id = {siteId:UUID} AND user_id = {userId:String}`,
      { siteId, userId }
    ),
    run<{ day: string; n: string }>(
      client,
      `SELECT toString(min(first_day)) AS day, count() AS n FROM user_first_day
       WHERE site_id = {siteId:UUID} AND user_id = {userId:String}`,
      { siteId, userId }
    ),
    run<RawItem>(
      client,
      `SELECT toString(event_id) AS eid, toUnixTimestamp64Milli(ts) AS ms, kind, summary,
              severity AS sev, ref, toString(session_hash) AS sess, release AS rel
       FROM user_timeline
       WHERE site_id = {siteId:UUID} AND user_id = {userId:String} AND kind = 'error'
       ORDER BY ts DESC, event_id DESC LIMIT 1`,
      { siteId, userId }
    ),
  ]);

  const t = totals[0];
  const has = Number(t?.n ?? 0) > 0;
  const lastError = error[0];
  return {
    firstSeen: Number(first[0]?.n ?? 0) > 0 ? first[0]!.day : null,
    lastSeen: has ? new Date(Number(t!.last_ms)).toISOString() : null,
    sessions: Number(t?.sessions ?? 0),
    pages: Number(t?.pages ?? 0),
    events: Number(t?.events ?? 0),
    errors: Number(t?.errors ?? 0),
    release: has ? t!.rel : "",
    country: has ? t!.ctry : "",
    device: has ? t!.dev : "",
    lastError: lastError
      ? { eventId: lastError.eid, at: new Date(Number(lastError.ms)).toISOString(), summary: lastError.summary, ref: lastError.ref }
      : null,
  };
}
