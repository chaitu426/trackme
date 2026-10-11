import { getClickHouseClient } from "@trackme/analytics";
import { env } from "@trackme/config";
import { db, sql, usageCounters } from "@trackme/db";
import { Redis } from "ioredis";

export interface UsageMeteringClient {
  query(params: {
    query: string;
    format: "JSONEachRow";
    query_params?: Record<string, unknown>;
  }): Promise<{ json<T>(): Promise<T[]> }>;
}

export interface UsageMeteringRedis {
  eval(script: string, numkeys: number, ...args: unknown[]): Promise<unknown>;
  disconnect(): void;
}

export interface UsageMeteringDB {
  insert(table: unknown): {
    values(rows: unknown[]): {
      onConflictDoUpdate(config: {
        target: unknown[];
        set: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
}

export interface UsageMeteringDeps {
  client?: UsageMeteringClient;
  redis?: UsageMeteringRedis;
  dbClient?: UsageMeteringDB;
  now?: Date;
  period?: string;
}

export const USAGE_METERING_SQL = `
  SELECT
    workspace_id,
    site_id,
    sum(total_count) AS event_count
  FROM event_rollups_daily
  WHERE date >= {start:Date}
    AND date < {end:Date}
  GROUP BY workspace_id, site_id
`;

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

export function monthBoundsFor(now: Date): { period: string; start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const period = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { period, start, end };
}

export async function runUsageMetering(deps: UsageMeteringDeps = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const { period, start, end } = monthBoundsFor(now);
  const currentPeriod = deps.period ?? period;
  const client = deps.client ?? (getClickHouseClient() as unknown as UsageMeteringClient);
  const redis =
    deps.redis ??
    new Redis(env.REDIS_STATE_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    }) as UsageMeteringRedis;
  const dbClient = deps.dbClient ?? (db as unknown as UsageMeteringDB);

  console.log(`📊 Running usage metering sync for period: ${currentPeriod}`);

  try {
    const resultSet = await client.query({
      query: USAGE_METERING_SQL,
      format: "JSONEachRow",
      query_params: { start, end },
    });
    const rows = await resultSet.json<{
      workspace_id: string;
      site_id: string | null;
      event_count: string | number;
    }>();

    if (rows.length > 0) {
      const values = rows.map((row) => ({
        workspaceId: row.workspace_id,
        siteId: row.site_id,
        period: currentPeriod,
        eventCount: Number(row.event_count || 0),
      }));

      await dbClient
        .insert(usageCounters)
        .values(values)
        .onConflictDoUpdate({
          target: [usageCounters.workspaceId, usageCounters.siteId, usageCounters.period],
          set: {
            eventCount: sql`excluded.event_count`,
            updatedAt: new Date(),
          },
        });
    }

    const workspaceTotals = new Map<string, number>();
    for (const row of rows) {
      const eventCount = Number(row.event_count || 0);
      workspaceTotals.set(
        row.workspace_id,
        (workspaceTotals.get(row.workspace_id) ?? 0) + eventCount
      );
    }

    const ttl = 40 * 24 * 60 * 60;
    for (const [workspaceId, total] of workspaceTotals) {
      const key = `usage:${workspaceId}:${currentPeriod}`;
      await redis.eval(reconcileScript, 1, key, total, ttl);
    }

    console.log(`✅ Usage metering sync complete for ${rows.length} site records.`);
  } finally {
    if (deps.redis === undefined) {
      redis.disconnect();
    }
  }
}

export default runUsageMetering;
