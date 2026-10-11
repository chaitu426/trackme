import crypto from "node:crypto";
import { Redis } from "ioredis";

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const RENEW_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], tonumber(ARGV[2]))
else
  return 0
end
`;

const JOB_HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60;
const JOB_HEARTBEAT_TTL_MULTIPLIER = 2;

export interface LockOptions {
  renewEveryMs?: number;
}

interface JobRunRecord {
  taskName: string;
  lockKey: string;
  status: "running" | "success" | "failed";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  rows?: number;
  error?: string;
  lockTtlSeconds: number;
}

function slugifyTaskName(taskName: string): string {
  return taskName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function extractRows(result: unknown): number | undefined {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.rows === "number") return record.rows;
    if (typeof record.rowCount === "number") return record.rowCount;
    if (typeof record.count === "number") return record.count;
  }
  return undefined;
}

function buildRunRecord(
  taskName: string,
  lockKey: string,
  status: JobRunRecord["status"],
  startedAt: number,
  lockTtlSeconds: number,
  endedAt?: number,
  rows?: number,
  error?: string
): JobRunRecord {
  const record: JobRunRecord = {
    taskName,
    lockKey,
    status,
    startedAt,
    lockTtlSeconds,
  };

  if (typeof endedAt === "number") {
    record.endedAt = endedAt;
    record.durationMs = endedAt - startedAt;
  }
  if (typeof rows === "number") {
    record.rows = rows;
  }
  if (error) {
    record.error = error;
  }
  return record;
}

async function recordJobRun(
  redis: Redis,
  taskName: string,
  lockKey: string,
  startedAt: number,
  lockTtlSeconds: number,
  status: JobRunRecord["status"],
  endedAt?: number,
  rows?: number,
  error?: string
): Promise<void> {
  const jobStateKey = `job:${slugifyTaskName(taskName)}:latest`;
  const historyKey = `job:${slugifyTaskName(taskName)}:history`;
  const record = buildRunRecord(
    taskName,
    lockKey,
    status,
    startedAt,
    lockTtlSeconds,
    endedAt,
    rows,
    error
  );

  const payload = JSON.stringify(record);
  await redis.set(jobStateKey, payload, "EX", 7 * 24 * 60 * 60);
  await redis.lpush(historyKey, payload);
  await redis.ltrim(historyKey, 0, 9);
  await redis.expire(historyKey, JOB_HISTORY_TTL_SECONDS);
}

async function maybeAlertStaleJob(redis: Redis, taskName: string, ttlSeconds: number): Promise<void> {
  const heartbeatKey = `job:${slugifyTaskName(taskName)}:heartbeat`;
  const staleValue = await redis.get(heartbeatKey);
  if (!staleValue) return;

  const lastHeartbeatMs = Number(staleValue);
  if (!Number.isFinite(lastHeartbeatMs)) return;

  const staleThresholdMs = ttlSeconds * 1000 * JOB_HEARTBEAT_TTL_MULTIPLIER;
  if (Date.now() - lastHeartbeatMs > staleThresholdMs) {
    console.warn(`🚨 [Job] ${taskName} appears stale; last heartbeat was ${new Date(lastHeartbeatMs).toISOString()}`);
  }
}

/**
 * Execute a scheduled task with a distributed Redis lock.
 * If another worker replica holds the lock, this worker skips gracefully.
 * The lock is renewed while the task is still running, and each run is recorded
 * to Redis so failures and stale jobs are observable without silent drops.
 */
export async function withDistributedLock(
  redis: Redis,
  lockKey: string,
  ttlSeconds: number,
  taskName: string,
  taskFn: () => Promise<unknown>,
  options: LockOptions = {}
): Promise<boolean> {
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  const heartbeatKey = `job:${slugifyTaskName(taskName)}:heartbeat`;
  const jobStateKey = `job:${slugifyTaskName(taskName)}:latest`;
  const renewEveryMs = options.renewEveryMs ?? Math.max(5_000, (ttlSeconds * 1000) / 2);

  try {
    await maybeAlertStaleJob(redis, taskName, ttlSeconds);

    const acquired = await redis.set(lockKey, token, "EX", ttlSeconds, "NX");
    if (acquired !== "OK") {
      console.log(`🔒 [Lock] ${taskName} is already locked by another replica. Skipping run.`);
      return false;
    }

    console.log(`🔑 [Lock] Acquired distributed lock for ${taskName} (TTL: ${ttlSeconds}s)`);
    await redis.set(jobStateKey, JSON.stringify(buildRunRecord(taskName, lockKey, "running", startedAt, ttlSeconds)), "EX", 7 * 24 * 60 * 60);
    const heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await redis.eval(RENEW_LOCK_LUA, 1, lockKey, token, ttlSeconds);
        if (renewed === 1) {
          await redis.set(heartbeatKey, String(Date.now()), "EX", ttlSeconds * JOB_HEARTBEAT_TTL_MULTIPLIER);
        } else {
          console.warn(`⚠️ [Lock] Failed to renew ${taskName}; lock was lost or stolen.`);
        }
      } catch (heartbeatErr) {
        console.error(`⚠️ [Lock] Error renewing lock for ${taskName}:`, heartbeatErr);
      }
    }, renewEveryMs);

    try {
      const result = await taskFn();
      const rows = extractRows(result);
      const endedAt = Date.now();
      await recordJobRun(redis, taskName, lockKey, startedAt, ttlSeconds, "success", endedAt, rows);
      console.log(`✅ [Job] ${taskName} completed successfully (${rows ?? 0} rows, ${endedAt - startedAt}ms)`);
      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const endedAt = Date.now();
      await recordJobRun(redis, taskName, lockKey, startedAt, ttlSeconds, "failed", endedAt, undefined, error);
      console.error(`🚨 [Job] ${taskName} failed after ${endedAt - startedAt}ms:`, err);
      throw err;
    } finally {
      clearInterval(heartbeatTimer);
    }
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
      console.log(`🔓 [Lock] Released distributed lock for ${taskName}`);
    } catch (releaseErr) {
      console.error(`⚠️ [Lock] Error releasing lock for ${taskName}:`, releaseErr);
    }
  }
}
