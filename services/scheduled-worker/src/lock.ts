import crypto from "node:crypto";
import { Redis } from "ioredis";

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Execute a scheduled task with a distributed Redis lock.
 * If another worker replica holds the lock, this worker skips gracefully.
 */
export async function withDistributedLock(
  redis: Redis,
  lockKey: string,
  ttlSeconds: number,
  taskName: string,
  taskFn: () => Promise<void>
): Promise<boolean> {
  const token = crypto.randomUUID();

  try {
    const acquired = await redis.set(lockKey, token, "EX", ttlSeconds, "NX");
    if (acquired !== "OK") {
      console.log(`🔒 [Lock] ${taskName} is already locked by another replica. Skipping run.`);
      return false;
    }

    console.log(`🔑 [Lock] Acquired distributed lock for ${taskName} (TTL: ${ttlSeconds}s)`);
    await taskFn();
    return true;
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
      console.log(`🔓 [Lock] Released distributed lock for ${taskName}`);
    } catch (releaseErr) {
      console.error(`⚠️ [Lock] Error releasing lock for ${taskName}:`, releaseErr);
    }
  }
}
