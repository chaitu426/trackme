import { getRedis } from "./redis";
import { AppError } from "@trackme/contracts";

// In-memory fallback map if Redis is temporarily unreachable
const memStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Sliding window or fixed window rate limiter backed by Redis with in-memory fallback.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  errorMessage = "Too many requests. Please try again later."
): Promise<{ remaining: number; resetInSeconds: number }> {
  try {
    const redis = getRedis();
    const redisKey = `ratelimit:${key}`;
    const count = await redis.incr(redisKey);

    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    const ttl = await redis.ttl(redisKey);
    const resetInSeconds = ttl > 0 ? ttl : windowSeconds;

    if (count > limit) {
      throw new AppError(429, "RATE_LIMITED", errorMessage);
    }

    return {
      remaining: Math.max(0, limit - count),
      resetInSeconds,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    // Fallback to in-memory rate limiting
    const now = Date.now();
    const entry = memStore.get(key);

    if (!entry || entry.resetAt <= now) {
      memStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { remaining: limit - 1, resetInSeconds: windowSeconds };
    }

    entry.count += 1;
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);

    if (entry.count > limit) {
      throw new AppError(429, "RATE_LIMITED", errorMessage);
    }

    return {
      remaining: Math.max(0, limit - entry.count),
      resetInSeconds,
    };
  }
}

/**
 * Record a failed credential attempt.
 * Locks the account/IP for lockoutSeconds once maxAttempts is reached.
 */
export async function recordFailedLoginAttempt(
  identifier: string,
  maxAttempts = 5,
  lockoutSeconds = 15 * 60
): Promise<{ attempts: number; isLocked: boolean; remainingAttempts: number }> {
  try {
    const redis = getRedis();
    const key = `auth_failures:${identifier.toLowerCase()}`;
    const attempts = await redis.incr(key);

    if (attempts === 1) {
      await redis.expire(key, lockoutSeconds);
    }

    const isLocked = attempts >= maxAttempts;
    return {
      attempts,
      isLocked,
      remainingAttempts: Math.max(0, maxAttempts - attempts),
    };
  } catch {
    return { attempts: 0, isLocked: false, remainingAttempts: maxAttempts };
  }
}

/**
 * Clear failed login attempts upon successful authentication.
 */
export async function clearFailedLoginAttempts(identifier: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`auth_failures:${identifier.toLowerCase()}`);
  } catch {
    // Non-fatal
  }
}
