import { getClickHouseClient } from "@trackme/analytics";
import { env } from "@trackme/config";
import { db, sites, sql } from "@trackme/db";

export interface RetentionClient {
  command(params: { query: string }): Promise<unknown>;
  /** Used only to look at the mutation backlog; clients without it skip that guard. */
  query?(params: { query: string; format: "JSONEachRow" }): Promise<{ json<T>(): Promise<T[]> }>;
}

export interface RetentionSiteRow {
  id: string;
  retentionMonths: number | null;
}

export interface RetentionDB {
  select: (config: unknown) => {
    from: (table: unknown) => Promise<RetentionSiteRow[]>;
  };
}

export interface RetentionDeps {
  client?: RetentionClient;
  dbClient?: RetentionDB;
  now?: Date;
}

/**
 * Every table that holds per-site data. Each also has a table TTL of 60 months (migration 012), which is
 * only the ceiling: this job is what enforces a site's own retention, including the 24-month default.
 */
export const RETENTION_TABLES = [
  { table: "events_raw", column: "timestamp", kind: "datetime" },
  { table: "web_vitals", column: "timestamp", kind: "datetime" },
  { table: "pageview_rollups_hourly", column: "hour_timestamp", kind: "datetime" },
  { table: "pageview_rollups_daily", column: "date", kind: "date" },
  { table: "event_rollups_daily", column: "date", kind: "date" },
  { table: "session_engagement_daily", column: "date", kind: "date" },
  { table: "daily_uniques", column: "date", kind: "date" },
  { table: "events_v2", column: "timestamp", kind: "datetime" },
  { table: "site_daily_agg", column: "date", kind: "date" },
  { table: "session_day_agg", column: "date", kind: "date" },
  { table: "dim_daily_agg", column: "date", kind: "date" },
  { table: "filter_daily_agg", column: "date", kind: "date" },
  { table: "event_daily_agg", column: "date", kind: "date" },
  { table: "web_vitals_agg", column: "date", kind: "date" },
  // Identified-user profiles (migration 013): emails and traits, so they follow retention like everything else.
  { table: "site_profiles_agg", column: "last_seen", kind: "datetime" },
] as const;

/** Site ids per statement; keeps one statement under ~20 KB. */
const SITE_IDS_PER_STATEMENT = 500;
/**
 * ClickHouse delays and then rejects further mutations when too many are pending on a table. Starting
 * a night's worth on top of an unfinished backlog just makes it worse, so wait for it to drain.
 */
export const MAX_PENDING_MUTATIONS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function retentionMonthsForSite(value: unknown, fallback = env.DEFAULT_RETENTION_MONTHS): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(60, Math.max(1, Math.round(parsed)));
}

export function cutoffForRetention(now: Date, months: number): Date {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1, 0, 0, 0, 0));
  return cutoff;
}

export function formatRetentionValue(date: Date, kind: "date" | "datetime"): string {
  if (kind === "date") return date.toISOString().slice(0, 10);
  return `${date.toISOString().slice(0, 19).replace("T", " ")}`;
}

/**
 * `siteIds` undefined = every site. Ids are validated as UUIDs before they are placed in the statement
 * (they come from our own database, but this string is a DELETE); an id that fails validation is dropped,
 * and an empty list deletes nothing.
 */
export function buildRetentionDeleteQuery(
  table: string,
  column: string,
  kind: "date" | "datetime",
  cutoff: Date,
  siteIds?: string[]
): string {
  const value = formatRetentionValue(cutoff, kind);
  const siteClause = siteIds
    ? ` AND site_id IN (${siteIds.filter((id) => UUID.test(id)).map((id) => `'${id}'`).join(", ")})`
    : "";
  return `ALTER TABLE ${table} DELETE WHERE ${column} < '${value}'${siteClause}`;
}

async function assertMutationHeadroom(client: RetentionClient): Promise<void> {
  if (!client.query) return;
  const rs = await client.query({ query: "SELECT count() AS n FROM system.mutations WHERE is_done = 0", format: "JSONEachRow" });
  const pending = Number((await rs.json<{ n: string | number }>())[0]?.n ?? 0);
  if (pending > MAX_PENDING_MUTATIONS) {
    throw new Error(`Retention skipped: ${pending} ClickHouse mutations are still pending (limit ${MAX_PENDING_MUTATIONS}); let them drain.`);
  }
}

async function runGlobalRetention(client: RetentionClient, months: number, now: Date): Promise<string[]> {
  const cutoff = cutoffForRetention(now, months);
  console.log(`🧹 Retention: delete rows older than ${cutoff.toISOString()} (global policy: ${months} months)`);

  const failures: string[] = [];
  for (const { table, column, kind } of RETENTION_TABLES) {
    try {
      await client.command({ query: buildRetentionDeleteQuery(table, column, kind, cutoff) });
      console.log(`  dropped ${table} older than ${formatRetentionValue(cutoff, kind)}`);
    } catch (error) {
      failures.push(`${table}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

/**
 * Sites are grouped by retention (there are only a handful of distinct values), so the cost is
 * classes x id-chunks x tables mutations a night, not sites x tables: 1,000 sites on 3 settings is
 * about 84 statements instead of 14,000.
 */
async function runSiteRetention(client: RetentionClient, dbClient: RetentionDB, now: Date): Promise<string[]> {
  const rows = (await dbClient
    .select({
      id: sites.id,
      retentionMonths: sql<number>`COALESCE((settings ->> 'retentionMonths')::int, ${env.DEFAULT_RETENTION_MONTHS})`,
    })
    .from(sites)) as RetentionSiteRow[];

  if (rows.length === 0) return runGlobalRetention(client, env.DEFAULT_RETENTION_MONTHS, now);

  const byMonths = new Map<number, string[]>();
  for (const row of rows) {
    const months = retentionMonthsForSite(row.retentionMonths, env.DEFAULT_RETENTION_MONTHS);
    byMonths.set(months, [...(byMonths.get(months) ?? []), row.id]);
  }

  const failures: string[] = [];
  for (const [months, ids] of byMonths) {
    const cutoff = cutoffForRetention(now, months);
    for (let i = 0; i < ids.length; i += SITE_IDS_PER_STATEMENT) {
      const chunk = ids.slice(i, i + SITE_IDS_PER_STATEMENT);
      for (const { table, column, kind } of RETENTION_TABLES) {
        try {
          await client.command({ query: buildRetentionDeleteQuery(table, column, kind, cutoff, chunk) });
        } catch (error) {
          failures.push(`${table} (${months} months, ${chunk.length} sites): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    console.log(`  retention ${months} months: ${ids.length} sites, rows before ${cutoff.toISOString().slice(0, 10)} removed`);
  }
  return failures;
}

/**
 * Apply retention using each site's configured value, falling back to the global setting when there are
 * no site rows to read from Postgres. A failed statement used to be a log line nobody read, which let
 * retention silently stop; now the run fails after trying everything, so the job metrics and alerts see it.
 */
export async function runRetentionCleanup(deps: RetentionDeps = {}): Promise<void> {
  const client = deps.client ?? (getClickHouseClient() as unknown as RetentionClient);
  const dbClient = deps.dbClient ?? (db as unknown as RetentionDB);
  const now = deps.now ?? new Date();

  await assertMutationHeadroom(client);
  const failures = await runSiteRetention(client, dbClient, now);
  if (failures.length > 0) {
    throw new Error(`Retention: ${failures.length} statement(s) failed. First: ${failures[0]}`);
  }
  console.log("✅ Retention cleanup submitted.");
}

export default runRetentionCleanup;
