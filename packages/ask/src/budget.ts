/**
 * Shared cost guards for Ask, kept in Redis so every worker node and every web replica sees the same numbers.
 *
 *   - Global rate: a token bucket caps planner completions per minute across all workspaces and nodes, so the fleet stays
 *     under the provider's limit and a burst cannot run up a bill.
 *   - Per-workspace concurrency: one workspace may have at most N planner completions in flight, so a single tenant cannot
 *     occupy the fleet.
 *
 * Both are best-effort and self-healing: a slot is leased with a TTL, so a crashed worker cannot hold one forever.
 */

/** The minimal Redis surface the budget needs; a real ioredis client satisfies it. */
export interface BudgetRedis {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<number>;
}

const RPM_KEY = "ask:llm:bucket";
const SLOT_PREFIX = "ask:ws:inflight:";

const TAKE_TOKEN_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local t = redis.call("HMGET", key, "tokens", "ts")
local tokens = tonumber(t[1])
local ts = tonumber(t[2])
if tokens == nil then tokens = capacity; ts = now end
local refill = math.floor((now - ts) / window_ms * capacity)
if refill > 0 then tokens = math.min(capacity, tokens + refill); ts = now end
if tokens < 1 then
  redis.call("HSET", key, "tokens", tokens, "ts", ts)
  return 0
end
redis.call("HSET", key, "tokens", tokens - 1, "ts", ts)
redis.call("PEXPIRE", key, window_ms * 2)
return 1
`;

const ACQUIRE_SLOT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local n = redis.call("INCR", key)
if n == 1 then redis.call("PEXPIRE", key, ttl) end
if n > limit then
  redis.call("DECR", key)
  return 0
end
return 1
`;

/** Take one completion from the shared per-minute bucket. Returns false when the minute's allowance is spent. */
export async function takeRpmToken(redis: BudgetRedis, capacity: number, now: number = Date.now()): Promise<boolean> {
  const ok = await redis.eval(TAKE_TOKEN_LUA, 1, RPM_KEY, capacity, 60_000, now);
  return ok === 1;
}

/** Claim a in-flight slot for a workspace. Returns a release function, or null when the workspace is at its limit. */
export async function acquireWorkspaceSlot(
  redis: BudgetRedis,
  workspaceId: string,
  limit: number,
  leaseMs = 30_000
): Promise<(() => Promise<void>) | null> {
  const key = `${SLOT_PREFIX}${workspaceId}`;
  const ok = await redis.eval(ACQUIRE_SLOT_LUA, 1, key, limit, leaseMs);
  if (ok !== 1) return null;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(`return redis.call("DECR", KEYS[1])`, 1, key);
  };
}

/** Current in-flight count for a workspace, for the panel's remaining-allowance display. */
export async function inFlight(redis: { get(key: string): Promise<string | null> }, workspaceId: string): Promise<number> {
  const v = await redis.get(`${SLOT_PREFIX}${workspaceId}`);
  return v ? Number(v) : 0;
}

/**
 * Read-only pre-check for the web route: would a run be refused right now? Takes nothing, so a refused request never spends
 * budget. A full workspace is reported as its own reason so the UI can say "one at a time" rather than "slow down".
 */
export async function limiterStatus(
  redis: { eval: BudgetRedis["eval"]; get(key: string): Promise<string | null> },
  workspaceId: string,
  limits: { capacity: number; workspaceLimit: number }
): Promise<{ ok: true } | { ok: false; reason: "workspace" | "global" }> {
  if ((await inFlight(redis, workspaceId)) >= limits.workspaceLimit) return { ok: false, reason: "workspace" };
  // A read, not a take: falls back to a full bucket before the bucket's first write.
  const tokens = await redis.eval(`return tonumber(redis.call("HGET", KEYS[1], "tokens") or ARGV[1])`, 1, RPM_KEY, limits.capacity);
  return Number(tokens) >= 1 ? { ok: true } : { ok: false, reason: "global" };
}
