import { getClickHouseClient } from "@trackme/analytics";
import { env } from "@trackme/config";
import { planDays, type WindowInput } from "./window.js";

/**
 * Daily rollups: pageviews, custom events, session engagement and distinct-count
 * states, one UTC day per statement.
 *
 * Each table is brought up to date independently. A run asks the table which day
 * it ends on and recomputes from there (see window.ts), so downtime, a new table,
 * or events that arrive late are all repaired by the next run instead of leaving
 * a permanent gap. Every insert is replace-by-key, so recomputing is safe.
 */

/** The slice of the ClickHouse client the jobs use, so tests can supply a fake. */
export interface RollupClient {
  command(params: { query: string; query_params?: Record<string, unknown> }): Promise<unknown>;
  query(params: { query: string; format: "JSONEachRow" }): Promise<{ json<T>(): Promise<T[]> }>;
}

export interface RollupSettings {
  lookbackDays: number;
  backfillDays: number;
  maxDaysPerRun: number;
}

export const PAGEVIEWS_SQL = `
  INSERT INTO pageview_rollups_daily (
    workspace_id, site_id, date, path, referrer, country, browser,
    device, campaign_source, campaign_medium, campaign_name,
    pageviews, unique_visitors, unique_sessions
  )
  SELECT
    workspace_id,
    site_id,
    toDate(timestamp) AS date,
    path,
    referrer,
    country,
    browser,
    device,
    campaign_source,
    campaign_medium,
    campaign_name,
    countIf(type = 'pageview') AS pageviews,
    uniqExact(visitor_pseudonym) AS unique_visitors,
    uniqExact(session_id) AS unique_sessions
  FROM events_raw
  WHERE toDate(timestamp) = {day:Date}
    AND bot_status = 'human'
  GROUP BY
    workspace_id, site_id, date, path, referrer, country, browser,
    device, campaign_source, campaign_medium, campaign_name
`;

export const EVENTS_SQL = `
  INSERT INTO event_rollups_daily (
    workspace_id, site_id, date, event_name,
    total_count, unique_sessions, unique_visitors
  )
  SELECT
    workspace_id,
    site_id,
    toDate(timestamp) AS date,
    event_name,
    count(*) AS total_count,
    uniqExact(session_id) AS unique_sessions,
    uniqExact(visitor_pseudonym) AS unique_visitors
  FROM events_raw
  WHERE toDate(timestamp) = {day:Date}
    AND type = 'custom'
    AND bot_status = 'human'
  GROUP BY workspace_id, site_id, date, event_name
`;

// Sessions are attributed to the UTC day they started. The events window reaches
// one day back and two days forward so a session that began on {day} and ran past
// midnight is measured in full, while one that began the day before is not
// mistaken for a new session starting on {day}.
export const ENGAGEMENT_SQL = `
  INSERT INTO session_engagement_daily (
    workspace_id, site_id, date,
    sessions, bounced_sessions, total_duration_seconds, pageviews
  )
  SELECT
    workspace_id,
    site_id,
    toDate(session_start) AS date,
    count() AS sessions,
    countIf(pageview_count = 1) AS bounced_sessions,
    sum(duration_seconds) AS total_duration_seconds,
    sum(pageview_count) AS pageviews
  FROM (
    SELECT
      workspace_id,
      site_id,
      session_id,
      min(timestamp) AS session_start,
      dateDiff('second', min(timestamp), max(timestamp)) AS duration_seconds,
      countIf(type = 'pageview') AS pageview_count
    FROM events_raw
    WHERE timestamp >= toDateTime64({day:Date}, 3, 'UTC') - INTERVAL 1 DAY
      AND timestamp <  toDateTime64({day:Date}, 3, 'UTC') + INTERVAL 2 DAY
      AND bot_status = 'human'
    GROUP BY workspace_id, site_id, session_id
  )
  WHERE toDate(session_start) = {day:Date}
  GROUP BY workspace_id, site_id, date
`;

export const UNIQUES_SQL = `
  INSERT INTO daily_uniques (workspace_id, site_id, date, visitors_state, sessions_state)
  SELECT
    workspace_id,
    site_id,
    toDate(timestamp) AS date,
    uniqCombined64State(visitor_pseudonym) AS visitors_state,
    uniqCombined64State(session_id) AS sessions_state
  FROM events_raw
  WHERE toDate(timestamp) = {day:Date}
    AND bot_status = 'human'
  GROUP BY workspace_id, site_id, date
`;

interface Group {
  name: string;
  /** Table whose newest day marks where this group left off. */
  table: string;
  statements: string[];
}

export const GROUPS: Group[] = [
  { name: "pageviews and events", table: "pageview_rollups_daily", statements: [PAGEVIEWS_SQL, EVENTS_SQL] },
  { name: "session engagement", table: "session_engagement_daily", statements: [ENGAGEMENT_SQL] },
  { name: "distinct counts", table: "daily_uniques", statements: [UNIQUES_SQL] },
];

function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Newest day in a rollup table, or null if it has no rows. */
async function lastRolledDate(client: RollupClient, table: string): Promise<string | null> {
  const result = await client.query({
    query: `SELECT toString(max(date)) AS last, count() AS n FROM ${table}`,
    format: "JSONEachRow",
  });
  const row = (await result.json<{ last: string; n: string | number }>())[0];
  return row && Number(row.n) > 0 ? row.last : null;
}

async function earliestEventDate(client: RollupClient): Promise<string | null> {
  const result = await client.query({
    query: `SELECT toString(min(toDate(timestamp))) AS first, count() AS n FROM events_raw`,
    format: "JSONEachRow",
  });
  const row = (await result.json<{ first: string; n: string | number }>())[0];
  return row && Number(row.n) > 0 ? row.first : null;
}

export function settingsFromEnv(): RollupSettings {
  return {
    lookbackDays: env.ROLLUP_LOOKBACK_DAYS,
    backfillDays: env.ROLLUP_BACKFILL_DAYS,
    maxDaysPerRun: env.ROLLUP_MAX_DAYS_PER_RUN,
  };
}

export async function runDailyRollups(
  deps: { client?: RollupClient; now?: Date; settings?: RollupSettings } = {}
): Promise<{ group: string; days: string[] }[]> {
  const client = deps.client ?? (getClickHouseClient() as unknown as RollupClient);
  const settings = deps.settings ?? settingsFromEnv();
  const today = utcToday(deps.now ?? new Date());

  const done: { group: string; days: string[] }[] = [];
  let earliest: string | null | undefined;

  for (const group of GROUPS) {
    const lastDate = await lastRolledDate(client, group.table);
    if (lastDate === null && earliest === undefined) earliest = await earliestEventDate(client);

    const input: WindowInput = { today, lastDate, earliestEvent: earliest ?? null, ...settings };
    const days = planDays(input);

    for (const day of days) {
      for (const query of group.statements) {
        await client.command({ query, query_params: { day } });
      }
    }
    done.push({ group: group.name, days });
    if (days.length > settings.lookbackDays + 1) {
      console.log(`⏰ Daily rollups (${group.name}): caught up ${days.length} days, ${days[0]} → ${days.at(-1)}`);
    }
  }

  console.log("✅ Daily rollups completed successfully.");
  return done;
}
