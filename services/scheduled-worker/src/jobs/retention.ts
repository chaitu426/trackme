import { getClickHouseClient } from "@trackme/analytics";
import { env } from "@trackme/config";

/**
 * Retention via DROP PARTITION (cheap) — not ALTER DELETE mutations.
 * Table TTL (migration 005) is the safety net; this job drops whole months
 * older than DEFAULT_RETENTION_MONTHS.
 */
export async function runRetentionCleanup(): Promise<void> {
  const months = env.DEFAULT_RETENTION_MONTHS;
  const client = getClickHouseClient();

  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  cutoff.setUTCDate(1);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffPartition = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;

  console.log(
    `🧹 Retention: DROP PARTITION where YYYYMM < ${cutoffPartition} (keep ${months} months)...`
  );

  const tables = [
    "events_raw",
    "web_vitals",
    "pageview_rollups_hourly",
    "pageview_rollups_daily",
    "event_rollups_daily",
    "session_engagement_daily",
  ];

  for (const table of tables) {
    try {
      const result = await client.query({
        query: `
          SELECT DISTINCT partition
          FROM system.parts
          WHERE database = currentDatabase()
            AND table = {table:String}
            AND active = 1
            AND partition < {cutoff:String}
          ORDER BY partition
        `,
        query_params: { table, cutoff: cutoffPartition },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ partition: string }>();

      for (const row of rows) {
        const partition = row.partition;
        if (!/^\d{6}$/.test(partition)) continue;
        await client.command({
          query: `ALTER TABLE ${table} DROP PARTITION '${partition}'`,
        });
        console.log(`  dropped ${table} partition ${partition}`);
      }
    } catch (error) {
      console.warn(`Retention skip for ${table}:`, error);
    }
  }

  console.log("✅ Retention partition drops submitted.");
}
