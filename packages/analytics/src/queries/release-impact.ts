import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";

/**
 * Inputs for the Release Impact Report: what happened in a window to the sessions on one release.
 *
 * Query plan: events_v2 is ordered (site_id, date, type, event_name, ...), so each query reads one site's rows for the
 * dates of a window (at most 72 hours, enforced) and only the types it needs (pageview, error, web_vital, custom). That is
 * a bounded drill-down over raw events, not a scan of the table; `release` is filtered after the read. The report page
 * caches the assembled result for 5 minutes, so N viewers cost one set of queries.
 * Every query binds {siteId}; callers must have authorized the site for the workspace.
 */

import type { SideInput } from "../release-report.js";

type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

export const MAX_WINDOW_HOURS = 72;
const MAX_SAMPLES = 20_000;

export interface Window {
  /** ISO timestamps, UTC. `to` is exclusive. */
  from: string;
  to: string;
}

const toCH = (iso: string) => iso.replace("T", " ").replace("Z", "");

function checkWindow(w: Window): void {
  const hours = (Date.parse(w.to) - Date.parse(w.from)) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_WINDOW_HOURS) {
    throw new AnalyticsQueryError(`A release window must be between 0 and ${MAX_WINDOW_HOURS} hours`);
  }
}

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse release impact query failed", { cause: err });
  }
}

const base = (siteId: string, release: string, w: Window): Params => ({ siteId, release, from: toCH(w.from), to: toCH(w.to) });
const TIME = "timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}";

export type Dimension = "total" | "browser" | "country" | "device";
const DIM_EXPR: Record<Dimension, string> = { total: "''", browser: "browser", country: "country", device: "device" };

export interface WindowRow {
  /** '' for the total. */
  value: string;
  sessions: number;
  /** Sessions in which at least one error was reported. */
  errorSessions: number;
  errors: number;
}

/** Sessions, sessions with an error and error count for one release in a window, overall or by one dimension. */
export async function getReleaseWindowStats(
  siteId: string,
  release: string,
  window: Window,
  dimension: Dimension,
  client: Client = getDashboardClickHouseClient()
): Promise<WindowRow[]> {
  checkWindow(window);
  const rows = await run<{ dv: string; sessions: string; err_sessions: string; errors: string }>(
    client,
    `SELECT toString(${DIM_EXPR[dimension]}) AS dv,
            uniqExactIf(session_hash, type = 'pageview') AS sessions,
            uniqExactIf(session_hash, type = 'error') AS err_sessions,
            countIf(type = 'error') AS errors
     FROM events_v2
     WHERE site_id = {siteId:UUID} AND bot_status = 'human' AND release = {release:String}
       AND ${TIME} AND type IN ('pageview', 'error')
     GROUP BY dv ORDER BY sessions DESC LIMIT 200`,
    base(siteId, release, window)
  );
  return rows.map((r) => ({ value: r.dv, sessions: Number(r.sessions), errorSessions: Number(r.err_sessions), errors: Number(r.errors) }));
}

/** Individual samples of a web vital (LCP, INP, ...) for a rank test. A random sample of at most 20,000 if there are more. */
export async function getVitalSamples(
  siteId: string,
  release: string,
  window: Window,
  vital: string,
  client: Client = getDashboardClickHouseClient()
): Promise<number[]> {
  checkWindow(window);
  const rows = await run<{ v: string | number }>(
    client,
    `SELECT vital_value AS v FROM events_v2
     WHERE site_id = {siteId:UUID} AND bot_status = 'human' AND type = 'web_vital' AND vital_name = {vital:String}
       AND release = {release:String} AND ${TIME}
     ORDER BY cityHash64(event_id) LIMIT {limit:UInt32}`,
    { ...base(siteId, release, window), vital, limit: MAX_SAMPLES }
  );
  return rows.map((r) => Number(r.v)).filter(Number.isFinite);
}

export interface GoalRule {
  type: string;
  eventName: string | null;
  pathPattern: string | null;
}

/** Same matching as the Goals page: a path rule is exact unless it has `*` or `%`; an event rule is the event name. */
export function goalCondition(goal: GoalRule): { sql: string; params: Params } | null {
  if (goal.type === "pageview_rule" && goal.pathPattern) {
    return goal.pathPattern.includes("%") || goal.pathPattern.includes("*")
      ? { sql: "type = 'pageview' AND path LIKE {pattern:String}", params: { pattern: goal.pathPattern.replace(/\*/g, "%") } }
      : { sql: "type = 'pageview' AND path = {path:String}", params: { path: goal.pathPattern } };
  }
  if (goal.type === "custom_event" && goal.eventName) {
    return { sql: "type = 'custom' AND event_name = {eventName:String}", params: { eventName: goal.eventName } };
  }
  return null;
}

/** Sessions on a release, and how many of them reached a goal. Null when the goal has no usable rule. */
export async function getGoalConversion(
  siteId: string,
  release: string,
  window: Window,
  goal: GoalRule,
  client: Client = getDashboardClickHouseClient()
): Promise<{ sessions: number; converted: number } | null> {
  checkWindow(window);
  const condition = goalCondition(goal);
  if (!condition) return null;
  const rows = await run<{ sessions: string; converted: string }>(
    client,
    `SELECT uniqExactIf(session_hash, type = 'pageview') AS sessions,
            uniqExactIf(session_hash, ${condition.sql}) AS converted
     FROM events_v2
     WHERE site_id = {siteId:UUID} AND bot_status = 'human' AND release = {release:String}
       AND ${TIME} AND type IN ('pageview', 'custom')`,
    { ...base(siteId, release, window), ...condition.params }
  );
  return { sessions: Number(rows[0]?.sessions ?? 0), converted: Number(rows[0]?.converted ?? 0) };
}

/** The release most sessions were on in a window, other than `exclude`: the build the new one replaced. Null when none. */
export async function findPreviousRelease(
  siteId: string,
  exclude: string,
  window: Window,
  client: Client = getDashboardClickHouseClient()
): Promise<string | null> {
  checkWindow(window);
  const rows = await run<{ release: string }>(
    client,
    `SELECT toString(release) AS release FROM events_v2
     WHERE site_id = {siteId:UUID} AND bot_status = 'human' AND type = 'pageview'
       AND release != '' AND release != {release:String} AND ${TIME}
     GROUP BY release ORDER BY uniqExact(session_hash) DESC LIMIT 1`,
    base(siteId, exclude, window)
  );
  return rows[0]?.release ?? null;
}

export interface ReleaseSeen {
  release: string;
  sessions: number;
  firstSeen: string;
}

/** Releases that have had sessions in the last 90 days, newest first, from the session summaries (no raw scan). */
export async function getReleasesSeen(siteId: string, client: Client = getDashboardClickHouseClient()): Promise<ReleaseSeen[]> {
  const rows = await run<{ rel: string; sessions: string; first_ms: string }>(
    client,
    `SELECT rel, count() AS sessions, toUnixTimestamp64Milli(min(first)) AS first_ms
     FROM (
       SELECT session_hash, argMaxIfMerge(release) AS rel, min(first_ts) AS first
       FROM session_summary_agg
       WHERE site_id = {siteId:UUID} AND date >= today() - 90
       GROUP BY session_hash
     )
     WHERE rel != '' GROUP BY rel ORDER BY first_ms DESC LIMIT 100`,
    { siteId }
  );
  return rows.map((r) => ({ release: r.rel, sessions: Number(r.sessions), firstSeen: new Date(Number(r.first_ms)).toISOString() }));
}

export interface NewIssue {
  groupId: string;
  title: string;
  events: number;
}

/** Issues first seen in this release since a moment, most frequent first. */
export async function getNewIssues(
  siteId: string,
  release: string,
  since: string,
  client: Client = getDashboardClickHouseClient()
): Promise<NewIssue[]> {
  const rows = await run<{ gid: string; title: string; events: string }>(
    client,
    `SELECT toString(group_id) AS gid, anyLast(title) AS title, sum(events) AS events
     FROM error_groups WHERE site_id = {siteId:UUID}
     GROUP BY group_id
     HAVING argMinMerge(first_release) = {release:String} AND min(first_seen) >= parseDateTime64BestEffort({since:String}, 3, 'UTC')
     ORDER BY events DESC LIMIT 20`,
    { siteId, release, since }
  );
  return rows.map((r) => ({ groupId: r.gid, title: r.title, events: Number(r.events) }));
}

export interface GatherOptions {
  siteId: string;
  release: string;
  /** When the release went live (the deploy webhook, or the first session seen on it). */
  deployedAt: string;
  windowHours: number;
  now?: Date;
  goal?: (GoalRule & { name: string }) | null | undefined;
}

/**
 * Everything the report needs, fetched in parallel: the previous release, then for each side the totals, breakdowns,
 * vital samples and goal conversion. The "after" side runs from the deploy to the end of the window or now, whichever is
 * first; the "before" side is the same length ending at the deploy, on the release that was live then.
 */
export async function gatherReportInput(
  o: GatherOptions,
  client: Client = getDashboardClickHouseClient()
): Promise<{
  previousRelease: string | null;
  before: SideInput;
  after: SideInput;
  newIssues: NewIssue[];
  windows: { before: Window; after: Window };
}> {
  const deployMs = Date.parse(o.deployedAt);
  const hours = Math.min(Math.max(o.windowHours, 1), MAX_WINDOW_HOURS);
  const nowMs = (o.now ?? new Date()).getTime();
  const afterEnd = Math.min(deployMs + hours * 3_600_000, nowMs);
  const afterWindow: Window = { from: new Date(deployMs).toISOString(), to: new Date(Math.max(afterEnd, deployMs + 1000)).toISOString() };
  // Same length as the after window, so the two sides cover the same amount of time (traffic mix still differs by hour).
  const length = Date.parse(afterWindow.to) - deployMs;
  const beforeWindow: Window = { from: new Date(deployMs - length).toISOString(), to: new Date(deployMs).toISOString() };

  const previousRelease = await findPreviousRelease(o.siteId, o.release, beforeWindow, client);

  const sideFor = async (release: string | null, window: Window): Promise<SideInput> => {
    if (!release) return { total: null, byDimension: {}, lcp: [], inp: [], conversion: null };
    const [total, browser, country, device, lcp, inp, conversion] = await Promise.all([
      getReleaseWindowStats(o.siteId, release, window, "total", client),
      getReleaseWindowStats(o.siteId, release, window, "browser", client),
      getReleaseWindowStats(o.siteId, release, window, "country", client),
      getReleaseWindowStats(o.siteId, release, window, "device", client),
      getVitalSamples(o.siteId, release, window, "LCP", client),
      getVitalSamples(o.siteId, release, window, "INP", client),
      o.goal ? getGoalConversion(o.siteId, release, window, o.goal, client) : Promise.resolve(null),
    ]);
    return { total: total[0] ?? null, byDimension: { browser, country, device }, lcp, inp, conversion };
  };

  const [before, after, newIssues] = await Promise.all([
    sideFor(previousRelease, beforeWindow),
    sideFor(o.release, afterWindow),
    getNewIssues(o.siteId, o.release, afterWindow.from, client),
  ]);
  return { previousRelease, before, after, newIssues, windows: { before: beforeWindow, after: afterWindow } };
}
