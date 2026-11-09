import type { ClickHouseClient } from "@clickhouse/client";
import { getDashboardClickHouseClient } from "../client.js";
import { AnalyticsQueryError } from "../errors.js";
import { AUTO_EVENT_NAMES } from "./engagement-sql.js";

/**
 * Retention cohorts over IDENTIFIED users (migration 017). Anonymous visitors rotate their id every 24 hours and
 * cannot be followed across days, so they are not here; callers must say so on the page.
 *
 * Query plan: user_first_day is ordered (site_id, user_id) and user_active_day / user_event_day by
 * (site_id, date|event_name, ...), so every scan starts at one site. A cohort query reads that site's cohort users
 * (one row per identified user) and their activity between the first cohort day and the last period needed:
 * identified-user-active-days in that window. That is a rollup (one row per user per day), never raw events.
 * Results are small: at most (cohorts x periods) cells.
 */

type Client = Pick<ClickHouseClient, "query">;
type Params = Record<string, unknown>;

export type RetentionGranularity = "day" | "week" | "month";
export type CohortDefinition = { kind: "first_visit" } | { kind: "event"; name: string };

export interface RetentionQuery {
  siteId: string;
  granularity: RetentionGranularity;
  /** Inclusive UTC dates (YYYY-MM-DD) bounding the first day of the cohorts to show. */
  from: string;
  to: string;
  cohort: CohortDefinition;
  /** Count a user as retained in a period when they did this event; omit for any activity. */
  returnEvent?: string | undefined;
  /** How many periods after the first to report (0 to 30). */
  periods: number;
  /** Restrict to these users (a saved segment), at most 50,000. */
  userIds?: string[] | undefined;
  /** For tests; defaults to the current time. */
  now?: Date;
}

export interface CohortRow {
  /** First day of the cohort's period: the day, the Monday, or the first of the month. */
  cohort: string;
  size: number;
  /** Users active in each period after the cohort's start; index 0 is the first period. null = that period has not happened yet. */
  retained: Array<number | null>;
}

const BUCKET: Record<RetentionGranularity, (expr: string) => string> = {
  day: (expr) => `toDate(${expr})`,
  week: (expr) => `toMonday(${expr})`,
  month: (expr) => `toStartOfMonth(${expr})`,
};

const DAYS_PER_PERIOD: Record<RetentionGranularity, number> = { day: 1, week: 7, month: 31 };
const MAX_USERS = 50_000;

const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The first day of the period that starts `count` periods after the cohort start. */
export function periodStart(cohort: string, granularity: RetentionGranularity, count: number): string {
  if (granularity === "day") return addDays(cohort, count);
  if (granularity === "week") return addDays(cohort, count * 7);
  const d = new Date(`${cohort}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + count);
  return d.toISOString().slice(0, 10);
}

async function run<T>(client: Client, query: string, params: Params): Promise<T[]> {
  try {
    const rs = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    if (err instanceof AnalyticsQueryError) throw err;
    throw new AnalyticsQueryError("ClickHouse retention query failed", { cause: err });
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getRetention(
  q: RetentionQuery,
  client: Client = getDashboardClickHouseClient()
): Promise<CohortRow[]> {
  if (!DATE.test(q.from) || !DATE.test(q.to) || q.from > q.to) throw new AnalyticsQueryError("Invalid cohort date range");
  const periods = Math.max(0, Math.min(30, Math.floor(q.periods)));
  const bucket = BUCKET[q.granularity];
  const today = (q.now ?? new Date()).toISOString().slice(0, 10);
  const lastNeeded = addDays(q.to, (periods + 1) * DAYS_PER_PERIOD[q.granularity]);
  const activityTo = lastNeeded < today ? lastNeeded : today;

  const params: Params = { siteId: q.siteId, from: q.from, to: q.to, activityTo };
  const users = (q.userIds ?? []).slice(0, MAX_USERS);
  const userFilter = q.userIds ? "AND user_id IN {users:Array(String)}" : "";
  if (q.userIds) params.users = users;

  let cohortSql: string;
  if (q.cohort.kind === "event") {
    params.cohortEvent = q.cohort.name;
    cohortSql = `SELECT user_id, min(date) AS cohort_day FROM user_event_day
                 WHERE site_id = {siteId:UUID} AND event_name = {cohortEvent:String} ${userFilter}
                 GROUP BY user_id HAVING cohort_day >= {from:Date} AND cohort_day <= {to:Date}`;
  } else {
    cohortSql = `SELECT user_id, min(first_day) AS cohort_day FROM user_first_day
                 WHERE site_id = {siteId:UUID} ${userFilter}
                 GROUP BY user_id HAVING cohort_day >= {from:Date} AND cohort_day <= {to:Date}`;
  }

  let activitySql: string;
  if (q.returnEvent) {
    params.returnEvent = q.returnEvent;
    activitySql = `SELECT user_id, date FROM user_event_day
                   WHERE site_id = {siteId:UUID} AND event_name = {returnEvent:String} AND date >= {from:Date} AND date <= {activityTo:Date}`;
  } else {
    activitySql = `SELECT user_id, date FROM user_active_day
                   WHERE site_id = {siteId:UUID} AND date >= {from:Date} AND date <= {activityTo:Date}`;
  }

  const [sizes, cells] = await Promise.all([
    run<{ cohort: string; size: string | number }>(
      client,
      `SELECT toString(${bucket("cohort_day")}) AS cohort, count() AS size FROM (${cohortSql}) GROUP BY cohort ORDER BY cohort`,
      params
    ),
    run<{ cohort: string; period: string | number; users: string | number }>(
      client,
      `SELECT toString(cohort) AS cohort, period, uniqExact(user_id) AS users
       FROM (
         SELECT c.user_id AS user_id,
                ${bucket("c.cohort_day")} AS cohort,
                dateDiff('${q.granularity}', ${bucket("c.cohort_day")}, ${bucket("a.date")}) AS period
         FROM (${cohortSql}) AS c
         INNER JOIN (${activitySql}) AS a ON c.user_id = a.user_id
         WHERE a.date >= c.cohort_day
       )
       WHERE period <= {periods:UInt8}
       GROUP BY cohort, period ORDER BY cohort, period`,
      { ...params, periods }
    ),
  ]);

  const byCohort = new Map<string, Map<number, number>>();
  for (const cell of cells) {
    const row = byCohort.get(cell.cohort) ?? new Map<number, number>();
    row.set(Number(cell.period), Number(cell.users));
    byCohort.set(cell.cohort, row);
  }

  return sizes.map((s) => {
    const row = byCohort.get(s.cohort);
    return {
      cohort: s.cohort,
      size: Number(s.size),
      // A period that starts after today has not happened: null, so the chart cannot show a false drop to zero.
      retained: Array.from({ length: periods + 1 }, (_, k) =>
        periodStart(s.cohort, q.granularity, k) > today ? null : (row?.get(k) ?? 0)
      ),
    };
  });
}

/** Custom events identified users have fired recently, most-used first, for the cohort and return pickers. */
export async function getRetentionEvents(
  siteId: string,
  client: Client = getDashboardClickHouseClient()
): Promise<Array<{ name: string; users: number }>> {
  const rows = await run<{ name: string; users: string | number }>(
    client,
    `SELECT event_name AS name, uniqExact(user_id) AS users FROM user_event_day
     WHERE site_id = {siteId:UUID} AND date >= today() - 90
     GROUP BY event_name ORDER BY users DESC LIMIT 60`,
    { siteId }
  );
  const auto = new Set<string>(AUTO_EVENT_NAMES);
  return rows.filter((r) => !auto.has(r.name)).map((r) => ({ name: r.name, users: Number(r.users) })).slice(0, 50);
}

/** How many identified users exist for the site: the denominator the page must show beside the chart. */
export async function countIdentifiedUsers(siteId: string, client: Client = getDashboardClickHouseClient()): Promise<number> {
  const rows = await run<{ n: string | number }>(
    client,
    `SELECT uniqExact(user_id) AS n FROM user_first_day WHERE site_id = {siteId:UUID}`,
    { siteId }
  );
  return Number(rows[0]?.n ?? 0);
}
