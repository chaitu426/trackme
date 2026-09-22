import { getClickHouseClient } from "@trackme/analytics";
import { env } from "@trackme/config";
import { db, usageCounters } from "@trackme/db";
import { Redis } from "ioredis";

/**
 * Synchronize monthly event counts from ClickHouse → Postgres usage_counters,
 * and reconcile Redis hot counters without clobbering live INCR.
 *
 * Redis is the hard ingest gate (atomic TryReserve). Metering must never SET
 * Redis below the live counter (lost events between CH lag and INCR), and
 * should raise Redis when the key was lost (max(ch, redis)).
 */
const reconcileScript = `
local key = KEYS[1]
local ch = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
local v = math.max(current, ch)
redis.call('SET', key, v, 'EX', ttl)
return v
`;

export async function runUsageMetering(): Promise<void> {
  const client = getClickHouseClient();
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  const currentPeriod = new Date().toISOString().substring(0, 7); // 'YYYY-MM'
  console.log(`📊 Running usage metering sync for period: ${currentPeriod}`);

  try {
    const query = `
      SELECT
        workspace_id,
        site_id,
        count(*) AS event_count
      FROM events_raw
      WHERE toYYYYMM(timestamp) = toYYYYMM(now())
      GROUP BY workspace_id, site_id
    `;

    const resultSet = await client.query({ query, format: "JSONEachRow" });
    const rows = await resultSet.json<{
      workspace_id: string;
      site_id: string;
      event_count: string | number;
    }>();

    const workspaceTotals = new Map<string, number>();

    for (const row of rows) {
      const eventCount = Number(row.event_count || 0);
      workspaceTotals.set(
        row.workspace_id,
        (workspaceTotals.get(row.workspace_id) ?? 0) + eventCount
      );

      await db
        .insert(usageCounters)
        .values({
          workspaceId: row.workspace_id,
          siteId: row.site_id,
          period: currentPeriod,
          eventCount,
        })
        .onConflictDoUpdate({
          target: [usageCounters.workspaceId, usageCounters.siteId, usageCounters.period],
          set: {
            eventCount,
            updatedAt: new Date(),
          },
        });
    }

    const ttl = 40 * 24 * 60 * 60;
    for (const [workspaceId, total] of workspaceTotals) {
      const key = `usage:${workspaceId}:${currentPeriod}`;
      await redis.eval(reconcileScript, 1, key, total, ttl);
    }

    console.log(`✅ Usage metering sync complete for ${rows.length} site records.`);
  } finally {
    redis.disconnect();
  }
}
