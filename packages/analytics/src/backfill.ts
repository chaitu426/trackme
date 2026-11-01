import type { ClickHouseClient } from "@clickhouse/client";

export interface BackfillOptions {
  /** First UTC day to copy, YYYY-MM-DD. */
  from: string;
  /** Last UTC day to copy, inclusive, YYYY-MM-DD. */
  to: string;
  /**
   * The moment the worker started writing events_ingest. Only legacy rows received before
   * it are copied: later ones are already in v2, and `received_at` (server time) rather than
   * `timestamp` is used so a late event with an old timestamp is not counted twice.
   */
  t0: string;
  /** Limit to one site (used by tests and for repairing a single tenant). */
  siteId?: string;
}

export type DayOutcome =
  | { day: string; action: "skipped"; legacy: number; v2: number }
  | { day: string; action: "copied"; legacy: number }
  | { day: string; action: "dry-run"; legacy: number };

/** Every UTC day from `from` to `to`, oldest first. */
export function planBackfillDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) throw new RangeError(`Invalid range ${from}..${to}`);
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

const siteClause = (siteId: string | undefined, column = "site_id") =>
  siteId ? `AND ${column} = {siteId:UUID}` : "";

/**
 * INSERT ... SELECT for one day. events_ingest takes the same strings the worker sends;
 * the materialized view hashes the ids and fills every aggregate, exactly as for live
 * traffic. Web vitals live in their own legacy table, so they are joined back by event_id.
 * FINAL applies the legacy table's own dedupe so a duplicated legacy row is copied once.
 */
export function buildBackfillInsert(options: Pick<BackfillOptions, "siteId">): string {
  return `
    INSERT INTO events_ingest
    SELECT
      e.event_id, 2 AS schema_version, e.workspace_id, e.site_id, e.site_key,
      e.timestamp, e.received_at, e.type, e.event_name, e.session_id, e.visitor_pseudonym,
      e.url, e.path, e.title, e.referrer,
      e.campaign_source, e.campaign_medium, e.campaign_name, e.campaign_term, e.campaign_content,
      e.country, e.city, e.browser, e.os, e.device, e.bot_status,
      ifNull(w.metric_name, '') AS vital_name,
      ifNull(w.metric_value, 0) AS vital_value,
      ifNull(w.rating, '') AS vital_rating,
      ifNull(w.navigation_type, '') AS vital_nav_type,
      e.properties_json
    FROM events_raw AS e FINAL
    LEFT JOIN (
      SELECT event_id, metric_name, metric_value, rating, navigation_type
      FROM web_vitals FINAL
      WHERE toDate(timestamp) = {day:Date} ${siteClause(options.siteId)}
    ) AS w ON w.event_id = e.event_id
    WHERE toDate(e.timestamp) = {day:Date}
      AND e.received_at < {t0:DateTime64}
      ${siteClause(options.siteId, "e.site_id")}
    SETTINGS max_insert_block_size = 100000, deduplicate_blocks_in_dependent_materialized_views = 1`;
}

type Count = { c: string | number };

/**
 * Copies legacy events into events_ingest one day at a time, oldest first.
 *
 * Safe to re-run: a day whose v2 row count already equals the legacy count is skipped. A
 * day that is partly present is an error, because inserting it again would double the
 * sum columns in the live aggregate tables; the operator must clear that day first.
 */
export async function backfillEventsV2(
  client: Pick<ClickHouseClient, "query" | "command">,
  options: BackfillOptions,
  { dryRun = false, onDay }: { dryRun?: boolean; onDay?: (outcome: DayOutcome) => void } = {}
): Promise<DayOutcome[]> {
  const outcomes: DayOutcome[] = [];
  const t0 = options.t0.replace("T", " ").replace("Z", "");

  for (const day of planBackfillDays(options.from, options.to)) {
    const params = { day, t0, ...(options.siteId ? { siteId: options.siteId } : {}) };
    const count = async (table: string, distinct: boolean) => {
      const what = distinct ? "uniqExact(event_id)" : "count()";
      const rs = await client.query({
        query: `SELECT ${what} AS c FROM ${table}
                WHERE toDate(timestamp) = {day:Date} AND received_at < {t0:DateTime64} ${siteClause(options.siteId)}`,
        query_params: params,
        format: "JSONEachRow",
      });
      return Number((await rs.json<Count>())[0]?.c ?? 0);
    };

    const legacy = await count("events_raw", true);
    const v2 = await count("events_v2", false);

    let outcome: DayOutcome;
    if (legacy === 0 || v2 === legacy) {
      outcome = { day, action: "skipped", legacy, v2 };
    } else if (v2 > 0) {
      throw new Error(
        `${day}: events_v2 already holds ${v2} of ${legacy} legacy events. Clear that day from events_v2 and the aggregate ` +
          `tables before re-running; copying again would double the sums.`
      );
    } else if (dryRun) {
      outcome = { day, action: "dry-run", legacy };
    } else {
      await client.command({ query: buildBackfillInsert(options), query_params: params });
      outcome = { day, action: "copied", legacy };
    }
    outcomes.push(outcome);
    onDay?.(outcome);
  }
  return outcomes;
}
