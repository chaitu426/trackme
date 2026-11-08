import { env } from "@trackme/config";
import { Redis } from "ioredis";
import { monthBoundsFor } from "./usage-metering.js";

/**
 * Gives back the quota a crashed ingestion edge was holding.
 *
 * With leased admission (services/ingestion-go/internal/lease) an edge withdraws quota from the
 * monthly counter in chunks and spends it locally. A graceful shutdown refunds the unspent part;
 * a crash cannot, and usage metering only ever raises the counter (max(redis, clickhouse)), so
 * the stranded units would be charged to the customer until month end.
 *
 * Each edge records what it holds in the HASH `lease:q:{workspace}` and heartbeats in the ZSET
 * `lease:edges`. This job finds ledger entries whose edge is no longer alive and subtracts them.
 * The ledger is up to one tick (2 s) stale, so a reclaim can under-charge by what the edge spent
 * in its last moments; that is bounded by one tick of traffic and errs in the customer's favour.
 *
 * It must talk to the Redis instance the edge uses (REDIS_URL), not the state instance. Around a
 * month boundary a reclaim lands on the new month's counter, once; it is capped by one chunk.
 */
const EDGES_KEY = "lease:edges";
const LEDGER_INDEX = "lease:q:index";
/** Living edges prune peers silent for six lease periods (60 s); this also covers "every edge is down". */
export const DEAD_AFTER_MS = 60_000;

export const RECLAIM_SCRIPT = `
local reclaimed = 0
local now, stale = tonumber(ARGV[1]), tonumber(ARGV[2])
for _, ws in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  local ledger = 'lease:q:' .. ws
  local entries = redis.call('HGETALL', ledger)
  for i = 1, #entries, 2 do
    local seen = redis.call('ZSCORE', KEYS[2], entries[i])
    if (not seen) or tonumber(seen) < now - stale then
      local n = tonumber(entries[i + 1])
      if n > 0 then
        redis.call('DECRBY', 'usage:' .. ws .. ':' .. ARGV[3], n)
        reclaimed = reclaimed + n
      end
      redis.call('HDEL', ledger, entries[i])
    end
  end
  if redis.call('HLEN', ledger) == 0 then redis.call('SREM', KEYS[1], ws) end
end
return reclaimed
`;

export interface ReclaimRedis {
  eval(script: string, numkeys: number, ...args: unknown[]): Promise<unknown>;
  disconnect(): void;
}

/** Returns how many quota units were given back. */
export async function reclaimDeadEdgeQuota(deps: { redis?: ReclaimRedis; now?: Date } = {}): Promise<number> {
  const now = deps.now ?? new Date();
  const redis =
    deps.redis ?? (new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true }) as ReclaimRedis);
  try {
    const units = Number(
      await redis.eval(RECLAIM_SCRIPT, 2, LEDGER_INDEX, EDGES_KEY, now.getTime(), DEAD_AFTER_MS, monthBoundsFor(now).period)
    );
    if (units > 0) console.log(`♻️ Gave back ${units} quota units held by dead ingestion edges.`);
    return units;
  } finally {
    if (deps.redis === undefined) redis.disconnect();
  }
}

export default reclaimDeadEdgeQuota;
