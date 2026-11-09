import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";

/**
 * Error Tracking reads (migration 016). Like the profile queries, these read v2-only tables and do not follow
 * ANALYTICS_READ.
 *
 * Query plan, per function:
 *  - listErrorGroups: error_group_daily is ordered (site_id, group_id, date, ...), so the range scan touches one
 *    site's rows only: groups x days x releases, a few thousand rows even for a busy site. error_groups is read
 *    for the same site with GROUP BY group_id to merge its aggregate states. Keyset pagination, no OFFSET.
 *  - getOccurrences / tag breakdown: error_occurrences is ordered (site_id, group_id, ts); at most 5 rows a day
 *    per issue exist, so a group's whole history is under 150 rows.
 * Every query binds {siteId}; the occurrence queries also bind {workspaceId}. Callers must have authorized the
 * site for the workspace first (requireDashboardSite).
 */

type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

export type ErrorSort = "last_seen" | "events" | "users";

export interface ErrorGroupRow {
  groupId: string;
  title: string;
  type: string;
  level: string;
  /** Events and distinct users inside the requested range. */
  events: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
  firstRelease: string;
  lastRelease: string;
}

export interface ErrorListQuery {
  siteId: string;
  /** Inclusive UTC dates, YYYY-MM-DD. */
  from: string;
  to: string;
  release?: string | undefined;
  environment?: string | undefined;
  level?: string | undefined;
  /** Restrict to these groups (a status filter resolved elsewhere), or exclude them. */
  onlyGroupIds?: string[] | undefined;
  excludeGroupIds?: string[] | undefined;
  sort: ErrorSort;
  /** Opaque value from a previous page's `nextCursor`. */
  cursor?: string | undefined;
  limit: number;
}

interface RawGroup {
  group_id: string;
  events: string | number;
  users: string | number;
  last_ts: string;
  sort_value: string | number;
  title: string;
  etype: string;
  level: string;
  first_seen: string;
  last_seen: string;
  first_release: string;
  last_release: string;
}

const fmt = (column: string) => `formatDateTime(${column}, '%Y-%m-%dT%H:%i:%S.000Z')`;

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse error-tracking query failed", { cause: err });
  }
}

const GROUP_ID = /^\d{1,20}$/;
/* ClickHouse rejects quoted values in Array(UInt64) parameters, so id lists are sent as strings and converted in SQL. */
/** Cursors are "<sort value>:<group id>", both digits. Anything else is ignored, never interpolated. */
export function parseCursor(cursor: string | undefined): { value: string; groupId: string } | null {
  const match = /^(\d{1,20}):(\d{1,20})$/.exec(cursor ?? "");
  return match ? { value: match[1]!, groupId: match[2]! } : null;
}

const SORT_EXPR: Record<ErrorSort, string> = {
  last_seen: "toUnixTimestamp64Milli(d.last_ts)",
  events: "d.events",
  users: "d.users",
};

/**
 * One page of issues, newest activity first by default. Asks for one extra row so the caller can tell whether
 * another page exists. `nextCursor` is the sort value and group id of the last row returned.
 */
export async function listErrorGroups(
  q: ErrorListQuery,
  client: Client = getDashboardClickHouseClient()
): Promise<{ groups: ErrorGroupRow[]; nextCursor: string | null }> {
  const params: Params = { siteId: q.siteId, from: q.from, to: q.to, limit: q.limit + 1 };
  const daily: string[] = [];
  if (q.release !== undefined) {
    daily.push("AND release = {release:String}");
    params.release = q.release;
  }
  if (q.environment !== undefined) {
    daily.push("AND environment = {environment:String}");
    params.environment = q.environment;
  }

  const outer: string[] = [];
  const onlyIds = (q.onlyGroupIds ?? []).filter((id) => GROUP_ID.test(id));
  const excludeIds = (q.excludeGroupIds ?? []).filter((id) => GROUP_ID.test(id));
  if (q.onlyGroupIds !== undefined) {
    outer.push("AND d.group_id IN arrayMap(x -> toUInt64(x), {onlyIds:Array(String)})");
    params.onlyIds = onlyIds;
  }
  if (excludeIds.length > 0) {
    outer.push("AND d.group_id NOT IN arrayMap(x -> toUInt64(x), {excludeIds:Array(String)})");
    params.excludeIds = excludeIds;
  }
  if (q.level !== undefined) {
    outer.push("AND g.level = {level:String}");
    params.level = q.level;
  }
  const cursor = parseCursor(q.cursor);
  if (cursor) {
    outer.push(`AND (${SORT_EXPR[q.sort]} < {cursorValue:UInt64}
      OR (${SORT_EXPR[q.sort]} = {cursorValue:UInt64} AND d.group_id < {cursorGroup:UInt64}))`);
    params.cursorValue = cursor.value;
    params.cursorGroup = cursor.groupId;
  }

  const rows = await run<RawGroup>(
    client,
    `SELECT toString(d.group_id) AS group_id, d.events AS events, d.users AS users, d.last_ts AS last_ts,
            ${SORT_EXPR[q.sort]} AS sort_value,
            g.title AS title, g.etype AS etype, g.level AS level,
            ${fmt("g.first_seen")} AS first_seen, ${fmt("g.last_seen")} AS last_seen,
            g.first_release AS first_release, g.last_release AS last_release
     FROM (
       SELECT group_id, sum(events) AS events, uniqCombined64Merge(users) AS users, max(last_ts) AS last_ts
       FROM error_group_daily
       WHERE site_id = {siteId:UUID} AND date >= {from:Date} AND date <= {to:Date} ${daily.join(" ")}
       GROUP BY group_id
     ) AS d
     INNER JOIN (
       SELECT group_id, anyLast(title) AS title, anyLast(etype) AS etype, anyLast(level) AS level,
              min(first_seen) AS first_seen, max(last_seen) AS last_seen,
              argMinMerge(first_release) AS first_release, argMaxMerge(last_release) AS last_release
       FROM error_groups WHERE site_id = {siteId:UUID} GROUP BY group_id
     ) AS g ON d.group_id = g.group_id
     WHERE 1 = 1 ${outer.join(" ")}
     ORDER BY sort_value DESC, d.group_id DESC
     LIMIT {limit:UInt32}`,
    params
  );

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    groups: page.map(toGroup),
    nextCursor: rows.length > q.limit && last ? `${last.sort_value}:${last.group_id}` : null,
  };
}

function toGroup(r: Omit<RawGroup, "last_ts" | "sort_value">): ErrorGroupRow {
  return {
    groupId: r.group_id,
    title: r.title,
    type: r.etype,
    level: r.level,
    events: Number(r.events),
    users: Number(r.users),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    firstRelease: r.first_release,
    lastRelease: r.last_release,
  };
}

/** One issue over its whole life (not just a range). Null when it does not exist for the site. */
export async function getErrorGroup(
  siteId: string,
  groupId: string,
  client: Client = getDashboardClickHouseClient()
): Promise<(ErrorGroupRow & { totalEvents: number; totalUsers: number }) | null> {
  if (!GROUP_ID.test(groupId)) return null;
  const rows = await run<Omit<RawGroup, "group_id" | "events" | "users" | "last_ts"> & { gid: string; total_events: string; total_users: string }>(
    client,
    `SELECT toString(group_id) AS gid,
            sum(events) AS total_events, uniqCombined64Merge(users) AS total_users,
            anyLast(title) AS title, anyLast(etype) AS etype, anyLast(level) AS level,
            ${fmt("min(first_seen)")} AS first_seen, ${fmt("max(last_seen)")} AS last_seen,
            argMinMerge(first_release) AS first_release, argMaxMerge(last_release) AS last_release,
            0 AS sort_value
     FROM error_groups
     WHERE site_id = {siteId:UUID} AND group_id = {groupId:UInt64}
     GROUP BY group_id`,
    { siteId, groupId }
  );
  const row = rows[0];
  if (!row) return null;
  const totalEvents = Number(row.total_events);
  const totalUsers = Number(row.total_users);
  return { ...toGroup({ ...row, group_id: row.gid, events: totalEvents, users: totalUsers }), totalEvents, totalUsers };
}

export interface TrendPoint {
  groupId: string;
  date: string;
  events: number;
}

/** Events per day for several issues at once, for the sparklines. One query for the whole page. */
export async function getErrorTrends(
  siteId: string,
  groupIds: string[],
  from: string,
  to: string,
  client: Client = getDashboardClickHouseClient()
): Promise<TrendPoint[]> {
  const ids = groupIds.filter((id) => GROUP_ID.test(id));
  if (ids.length === 0) return [];
  const rows = await run<{ gid: string; day: string; events: string | number }>(
    client,
    `SELECT toString(group_id) AS gid, toString(date) AS day, sum(events) AS events
     FROM error_group_daily
     WHERE site_id = {siteId:UUID} AND group_id IN arrayMap(x -> toUInt64(x), {ids:Array(String)}) AND date >= {from:Date} AND date <= {to:Date}
     GROUP BY group_id, date ORDER BY group_id, date`,
    { siteId, ids, from, to }
  );
  return rows.map((r) => ({ groupId: r.gid, date: r.day, events: Number(r.events) }));
}

export interface ReleaseSlice {
  release: string;
  environment: string;
  events: number;
  users: number;
}

/** How an issue splits across releases and environments in a range. */
export async function getErrorReleaseBreakdown(
  siteId: string,
  groupId: string,
  from: string,
  to: string,
  client: Client = getDashboardClickHouseClient()
): Promise<ReleaseSlice[]> {
  if (!GROUP_ID.test(groupId)) return [];
  const rows = await run<{ release: string; environment: string; events: string; users: string }>(
    client,
    `SELECT release, environment, sum(events) AS events, uniqCombined64Merge(users) AS users
     FROM error_group_daily
     WHERE site_id = {siteId:UUID} AND group_id = {groupId:UInt64} AND date >= {from:Date} AND date <= {to:Date}
     GROUP BY release, environment ORDER BY events DESC LIMIT 20`,
    { siteId, groupId, from, to }
  );
  return rows.map((r) => ({ release: r.release, environment: r.environment, events: Number(r.events), users: Number(r.users) }));
}

export interface OccurrenceRow {
  eventId: string;
  occurredAt: string;
  release: string;
  environment: string;
  sessionId: string;
  userId: string;
  path: string;
  browser: string;
  os: string;
  stack: string;
  breadcrumbs: string;
  tags: string;
}

/** The newest sampled occurrences of an issue (at most 5 a day exist), with stack, breadcrumbs and tags. */
export async function getOccurrences(
  workspaceId: string,
  siteId: string,
  groupId: string,
  limit: number,
  client: Client = getDashboardClickHouseClient()
): Promise<OccurrenceRow[]> {
  if (!GROUP_ID.test(groupId)) return [];
  const rows = await run<Record<string, string>>(
    client,
    `SELECT toString(event_id) AS event_id, ${fmt("ts")} AS occurred_at, release, environment, session_id, user_id,
            path, browser, os, stack, breadcrumbs, tags
     FROM error_occurrences
     WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND group_id = {groupId:UInt64}
     ORDER BY ts DESC LIMIT {limit:UInt32}`,
    { workspaceId, siteId, groupId, limit }
  );
  return rows.map((r) => ({
    eventId: r.event_id!,
    occurredAt: r.occurred_at!,
    release: r.release!,
    environment: r.environment!,
    sessionId: r.session_id!,
    userId: r.user_id!,
    path: r.path!,
    browser: r.browser!,
    os: r.os!,
    stack: r.stack!,
    breadcrumbs: r.breadcrumbs!,
    tags: r.tags!,
  }));
}

export interface TagCount {
  key: string;
  value: string;
  count: number;
}

/** Most common tag values across an issue's sampled occurrences. */
export async function getTagBreakdown(
  workspaceId: string,
  siteId: string,
  groupId: string,
  client: Client = getDashboardClickHouseClient()
): Promise<TagCount[]> {
  if (!GROUP_ID.test(groupId)) return [];
  const rows = await run<{ key: string; value: string; count: string }>(
    client,
    `SELECT kv.1 AS key, kv.2 AS value, count() AS count
     FROM error_occurrences
     ARRAY JOIN JSONExtractKeysAndValues(tags, 'String') AS kv
     WHERE workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID} AND group_id = {groupId:UInt64}
     GROUP BY key, value ORDER BY count DESC, key LIMIT 30`,
    { workspaceId, siteId, groupId }
  );
  return rows.map((r) => ({ key: r.key, value: r.value, count: Number(r.count) }));
}

/** Where an issue has shown up since a moment, per release: what the regression check reads. */
export interface RecentRelease {
  siteId: string;
  groupId: string;
  release: string;
  lastSeen: string;
}

export async function getRecentReleasesForGroups(
  groups: Array<{ siteId: string; groupId: string; since: string }>,
  client: Client = getDashboardClickHouseClient()
): Promise<RecentRelease[]> {
  const valid = groups.filter((g) => GROUP_ID.test(g.groupId) && /^[0-9a-f-]{36}$/i.test(g.siteId));
  if (valid.length === 0) return [];
  const earliest = valid.reduce((min, g) => (g.since < min ? g.since : min), valid[0]!.since);
  const rows = await run<{ sid: string; gid: string; rel: string; last_seen: string }>(
    client,
    `SELECT toString(site_id) AS sid, toString(group_id) AS gid, toString(release) AS rel,
            ${fmt("max(ts)")} AS last_seen
     FROM error_events
     WHERE ts > parseDateTime64BestEffort({since:String}, 3, 'UTC')
       AND has(arrayZip(arrayMap(x -> toUUID(x), {sites:Array(String)}), arrayMap(x -> toUInt64(x), {groups:Array(String)})), (site_id, group_id))
     GROUP BY site_id, group_id, release`,
    { since: earliest, sites: valid.map((g) => g.siteId), groups: valid.map((g) => g.groupId) }
  );
  return rows.map((r) => ({ siteId: r.sid, groupId: r.gid, release: r.rel, lastSeen: r.last_seen }));
}

export interface ErrorFilterOptions {
  releases: string[];
  environments: string[];
}

/** The releases and environments that have errors in a range, for the filter dropdowns. Newest activity first. */
export async function getErrorFilterOptions(
  siteId: string,
  from: string,
  to: string,
  client: Client = getDashboardClickHouseClient()
): Promise<ErrorFilterOptions> {
  const rows = await run<{ release: string; environment: string }>(
    client,
    `SELECT release, environment, max(last_ts) AS latest
     FROM error_group_daily
     WHERE site_id = {siteId:UUID} AND date >= {from:Date} AND date <= {to:Date}
     GROUP BY release, environment ORDER BY latest DESC LIMIT 200`,
    { siteId, from, to }
  );
  const unique = (values: string[]) => [...new Set(values.filter((value) => value !== ""))];
  return { releases: unique(rows.map((r) => r.release)).slice(0, 50), environments: unique(rows.map((r) => r.environment)) };
}
