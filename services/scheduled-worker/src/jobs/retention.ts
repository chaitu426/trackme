import { getClickHouseClient } from "@trackme/analytics";
import { env } from "@trackme/config";
import { db, sites, sql } from "@trackme/db";

export interface RetentionClient {
  command(params: { query: string }): Promise<unknown>;
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

export const RETENTION_TABLES = [
  { table: "events_raw", column: "timestamp", kind: "datetime" },
  { table: "web_vitals", column: "timestamp", kind: "datetime" },
  { table: "pageview_rollups_hourly", column: "hour_timestamp", kind: "datetime" },
  { table: "pageview_rollups_daily", column: "date", kind: "date" },
  { table: "event_rollups_daily", column: "date", kind: "date" },
  { table: "session_engagement_daily", column: "date", kind: "date" },
  { table: "daily_uniques", column: "date", kind: "date" },
] as const;

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

export function buildRetentionDeleteQuery(
  table: string,
  column: string,
  kind: "date" | "datetime",
  cutoff: Date,
  siteId?: string
): string {
  const value = formatRetentionValue(cutoff, kind);
  const siteClause = siteId ? ` AND site_id = '${siteId.replace(/'/g, "''")}'` : "";
  return `ALTER TABLE ${table} DELETE WHERE ${column} < '${value}'${siteClause}`;
}

async function runGlobalRetention(client: RetentionClient, months: number, now: Date): Promise<void> {
  const cutoff = cutoffForRetention(now, months);
  console.log(`🧹 Retention: delete rows older than ${cutoff.toISOString()} (global policy: ${months} months)`);

  for (const { table, column, kind } of RETENTION_TABLES) {
    try {
      const query = buildRetentionDeleteQuery(table, column, kind, cutoff);
      await client.command({ query });
      console.log(`  dropped ${table} older than ${formatRetentionValue(cutoff, kind)}`);
    } catch (error) {
      console.warn(`Retention skip for ${table}:`, error);
    }
  }
}

async function runSiteRetention(client: RetentionClient, dbClient: RetentionDB, now: Date): Promise<void> {
  const rows = (await dbClient
    .select({
      id: sites.id,
      retentionMonths: sql<number>`COALESCE((settings ->> 'retentionMonths')::int, ${env.DEFAULT_RETENTION_MONTHS})`,
    })
    .from(sites)) as RetentionSiteRow[];

  if (rows.length === 0) {
    await runGlobalRetention(client, env.DEFAULT_RETENTION_MONTHS, now);
    return;
  }

  for (const row of rows) {
    const months = retentionMonthsForSite(row.retentionMonths, env.DEFAULT_RETENTION_MONTHS);
    const cutoff = cutoffForRetention(now, months);

    for (const { table, column, kind } of RETENTION_TABLES) {
      try {
        const query = buildRetentionDeleteQuery(table, column, kind, cutoff, row.id);
        await client.command({ query });
        console.log(`  dropped ${table} for site ${row.id} older than ${formatRetentionValue(cutoff, kind)}`);
      } catch (error) {
        console.warn(`Retention skip for ${table} site=${row.id}:`, error);
      }
    }
  }
}

/**
 * Apply retention using each site's configured value, falling back to the global
 * setting when there are no site rows to read from Postgres.
 */
export async function runRetentionCleanup(deps: RetentionDeps = {}): Promise<void> {
  const client = deps.client ?? (getClickHouseClient() as unknown as RetentionClient);
  const dbClient = deps.dbClient ?? (db as unknown as RetentionDB);
  const now = deps.now ?? new Date();

  await runSiteRetention(client, dbClient, now);
  console.log("✅ Retention cleanup submitted.");
}

export default runRetentionCleanup;
