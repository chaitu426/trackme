import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";

/**
 * Identified-user profiles, read from site_profiles_agg (migration 013), which a materialized view
 * keeps up to date from the event stream. Every read merges the aggregate states, so it is right before
 * and after background merges. The table only exists in the v2 pipeline, so these functions do not
 * follow ANALYTICS_READ.
 *
 * `traits` is the latest identify event's properties, which also holds `eventName` and `distinctId`;
 * those two are removed on the way out.
 */
export interface ProfileRow {
  /** Same as distinctId; there is no separate row id. */
  id: string;
  distinctId: string;
  name: string | null;
  email: string | null;
  traits: Record<string, unknown>;
  totalSessions: number;
  totalEvents: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** The profile conditions a segment can use. Structurally the same as the web app's ProfileCondition. */
export type ProfileFilter =
  | { field: "trait"; key: string; op: "eq" | "neq" | "contains" | "exists" | "missing" | "gt" | "lt"; value?: string | undefined }
  | { field: "lastSeen" | "firstSeen"; op: "within" | "before"; days: number }
  | { field: "sessions" | "events"; op: "gte" | "lte"; value: number }
  | { field: "email"; op: "exists" | "missing" | "contains"; value?: string | undefined };

type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

const TENANT = `workspace_id = {workspaceId:UUID} AND site_id = {siteId:UUID}`;

/** One row per person with merged states. Aliases: fs/ls first/last seen, ev events, ss sessions, tr traits JSON. */
const grouped = (extraWhere = "", having = "") => `
  SELECT distinct_id,
         min(first_seen) AS fs, max(last_seen) AS ls, sum(events) AS ev,
         uniqCombined64Merge(sessions) AS ss, argMaxMerge(traits) AS tr
  FROM site_profiles_agg
  WHERE ${TENANT}${extraWhere}
  GROUP BY distinct_id${having ? ` HAVING ${having}` : ""}`;

const OUT = `distinct_id,
  formatDateTime(fs, '%Y-%m-%dT%H:%i:%SZ') AS first_seen_at,
  formatDateTime(ls, '%Y-%m-%dT%H:%i:%SZ') AS last_seen_at,
  ev AS total_events, ss AS total_sessions, tr AS traits`;

interface RawRow {
  distinct_id: string;
  first_seen_at: string;
  last_seen_at: string;
  total_events: string | number;
  total_sessions: string | number;
  traits: string;
}

export function toProfile(row: RawRow): ProfileRow {
  let traits: Record<string, unknown> = {};
  try {
    const parsed: unknown = row.traits ? JSON.parse(row.traits) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) traits = parsed as Record<string, unknown>;
  } catch {
    // a malformed blob shows as a profile with no traits rather than failing the page
  }
  delete traits.eventName;
  delete traits.distinctId;
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    id: row.distinct_id,
    distinctId: row.distinct_id,
    name: text(traits.name),
    email: text(traits.email),
    traits,
    totalSessions: Number(row.total_sessions),
    totalEvents: Number(row.total_events),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function run<T = RawRow>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse profile query failed", { cause: err });
  }
}

/** Newest activity first. Asks for one extra row so the caller can tell whether another page exists. */
export async function listProfiles(
  q: {
    workspaceId: string;
    siteId: string;
    search?: string;
    /** People to include even when the search text is not in their event-derived traits (matched elsewhere, e.g. server-supplied names). */
    alsoIds?: string[];
    limit: number;
    offset: number;
  },
  client: Client = getDashboardClickHouseClient()
): Promise<{ profiles: ProfileRow[]; hasMore: boolean }> {
  const search = q.search?.trim();
  const having = search
    ? `positionCaseInsensitiveUTF8(distinct_id, {q:String}) > 0
       OR positionCaseInsensitiveUTF8(JSONExtractString(tr, 'name'), {q:String}) > 0
       OR positionCaseInsensitiveUTF8(JSONExtractString(tr, 'email'), {q:String}) > 0${
         q.alsoIds && q.alsoIds.length > 0 ? `
       OR distinct_id IN {alsoIds:Array(String)}` : ""
       }`
    : "";
  const rows = await run(
    client,
    `SELECT ${OUT} FROM (${grouped("", having)}) ORDER BY ls DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    {
      workspaceId: q.workspaceId,
      siteId: q.siteId,
      q: search ?? "",
      ...(search && q.alsoIds && q.alsoIds.length > 0 ? { alsoIds: q.alsoIds.slice(0, 500) } : {}),
      limit: q.limit + 1,
      offset: q.offset,
    }
  );
  return { profiles: rows.slice(0, q.limit).map(toProfile), hasMore: rows.length > q.limit };
}

export async function profileStats(
  workspaceId: string,
  siteId: string,
  client: Client = getDashboardClickHouseClient()
): Promise<{ total: number; active7d: number; avgEvents: number }> {
  const rows = await run<{ total: string | number; active7d: string | number; avg_events: string | number | null }>(
    client,
    `SELECT count() AS total, countIf(ls >= now() - toIntervalDay(7)) AS active7d, avg(ev) AS avg_events FROM (${grouped()})`,
    { workspaceId, siteId }
  );
  const avg = Number(rows[0]?.avg_events ?? 0);
  return { total: Number(rows[0]?.total ?? 0), active7d: Number(rows[0]?.active7d ?? 0), avgEvents: Number.isFinite(avg) ? Math.round(avg) : 0 };
}

export async function getProfile(
  workspaceId: string,
  siteId: string,
  distinctId: string,
  client: Client = getDashboardClickHouseClient()
): Promise<ProfileRow | null> {
  const rows = await run(client, `SELECT ${OUT} FROM (${grouped(" AND distinct_id = {id:String}")})`, {
    workspaceId,
    siteId,
    id: distinctId,
  });
  return rows[0] ? toProfile(rows[0]) : null;
}

/** The trait's value as text whatever its JSON type (a number or boolean has no string form in JSONExtractString). */
const traitText = (i: number) => `trim(BOTH '"' FROM JSONExtractRaw(tr, {p${i}k:String}))`;

/** One condition as a ClickHouse predicate over the merged aliases. Values are bound parameters. */
export function conditionSql(c: ProfileFilter, i: number, params: Params): string {
  switch (c.field) {
    case "trait": {
      params[`p${i}k`] = c.key;
      params[`p${i}v`] = c.value ?? "";
      const has = `JSONHas(tr, {p${i}k:String})`;
      switch (c.op) {
        case "eq":
          return `(${has} AND ${traitText(i)} = {p${i}v:String})`;
        case "neq":
          return `(NOT ${has} OR ${traitText(i)} != {p${i}v:String})`;
        case "contains":
          return `positionCaseInsensitiveUTF8(${traitText(i)}, {p${i}v:String}) > 0`;
        case "exists":
          return has;
        case "missing":
          return `NOT ${has}`;
        case "gt":
        case "lt": {
          const n = Number(c.value);
          if (!Number.isFinite(n)) return "0"; // not a number: nothing can compare
          params[`p${i}n`] = n;
          return `toFloat64OrNull(${traitText(i)}) ${c.op === "gt" ? ">" : "<"} {p${i}n:Float64}`;
        }
      }
      break;
    }
    case "lastSeen":
    case "firstSeen": {
      params[`p${i}d`] = c.days;
      const col = c.field === "lastSeen" ? "ls" : "fs";
      return `${col} ${c.op === "within" ? ">=" : "<"} now() - toIntervalDay({p${i}d:UInt16})`;
    }
    case "sessions":
    case "events": {
      params[`p${i}n`] = c.value;
      return `${c.field === "sessions" ? "ss" : "ev"} ${c.op === "gte" ? ">=" : "<="} {p${i}n:UInt64}`;
    }
    case "email": {
      const email = `JSONExtractString(tr, 'email')`;
      if (c.op === "contains") {
        params[`p${i}v`] = c.value ?? "";
        return `positionCaseInsensitiveUTF8(${email}, {p${i}v:String}) > 0`;
      }
      return c.op === "exists" ? `${email} != ''` : `${email} = ''`;
    }
  }
  throw new Error("Unsupported segment condition");
}

/** The HAVING clause for a segment's profile conditions ("" when there are none). */
export function buildProfileHaving(conditions: ProfileFilter[], match: "all" | "any"): { having: string; params: Params } {
  const params: Params = {};
  const parts = conditions.map((c, i) => conditionSql(c, i, params));
  return { having: parts.length === 0 ? "" : `(${parts.join(match === "any" ? " OR " : " AND ")})`, params };
}

/** The most recently active people matching the conditions, up to `limit`. */
export async function findProfiles(
  q: { workspaceId: string; siteId: string; conditions: ProfileFilter[]; match: "all" | "any"; limit: number },
  client: Client = getDashboardClickHouseClient()
): Promise<ProfileRow[]> {
  const { having, params } = buildProfileHaving(q.conditions, q.match);
  const rows = await run(client, `SELECT ${OUT} FROM (${grouped("", having)}) ORDER BY ls DESC LIMIT {limit:UInt32}`, {
    ...params,
    workspaceId: q.workspaceId,
    siteId: q.siteId,
    limit: q.limit,
  });
  return rows.map(toProfile);
}
