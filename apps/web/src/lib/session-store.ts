import { createHash } from "node:crypto";
import { db, sessions, eq, and, gt } from "@trackme/db";
import { env } from "@trackme/config";
import { getRedis } from "./redis";
import {
  SESSION_COOKIE,
  signSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  type SessionPayload,
} from "./session";

export const SESSION_SHORT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const SESSION_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type RegisteredSessionResult = {
  token: string;
  expiresAt: Date;
  maxAgeSeconds: number;
};

/**
 * Creates a server-tracked session in both PostgreSQL and Redis.
 */
export async function createRegisteredSession(params: {
  userId: string;
  email: string;
  rememberMe?: boolean | undefined;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}): Promise<RegisteredSessionResult> {
  const ttlSeconds = params.rememberMe ? SESSION_REMEMBER_TTL_SECONDS : SESSION_SHORT_TTL_SECONDS;
  const token = await signSessionToken(
    { userId: params.userId, email: params.email },
    env.NEXTAUTH_SECRET,
    ttlSeconds
  );

  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  // Store in PostgreSQL
  try {
    await db.insert(sessions).values({
      userId: params.userId,
      tokenHash,
      userAgent: params.userAgent?.slice(0, 500) ?? null,
      ipAddress: params.ipAddress?.slice(0, 100) ?? null,
      revoked: false,
      expiresAt,
    });
  } catch (error) {
    console.error("[Session] Failed to persist session in DB:", error);
  }

  // Cache in Redis for ultra-fast validation
  try {
    const redis = getRedis();
    const redisKey = `session:${tokenHash}`;
    await redis.set(
      redisKey,
      JSON.stringify({
        userId: params.userId,
        email: params.email,
        expiresAt: expiresAt.toISOString(),
        revoked: false,
      }),
      "EX",
      ttlSeconds
    );
  } catch (error) {
    console.warn("[Session] Failed to cache session in Redis:", error);
  }

  return {
    token,
    expiresAt,
    maxAgeSeconds: ttlSeconds,
  };
}

/**
 * Validates a session token against Redis cache and the PostgreSQL database.
 * Returns the decoded session payload if valid, active, and not revoked.
 */
export async function validateRegisteredSession(
  token: string | undefined
): Promise<(SessionPayload & { remainingSeconds: number }) | null> {
  if (!token) return null;

  // 1. Cryptographic HMAC check first
  const payload = await verifySessionToken(token, env.NEXTAUTH_SECRET);
  if (!payload) return null;

  const tokenHash = hashSessionToken(token);
  const now = Math.floor(Date.now() / 1000);
  const remainingSeconds = Math.max(0, payload.exp - now);

  if (remainingSeconds <= 0) {
    return null;
  }

  // 2. Check Redis cache for fast revocation lookup
  try {
    const redis = getRedis();
    const cached = await redis.get(`session:${tokenHash}`);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.revoked === true) {
        return null;
      }
      return { ...payload, remainingSeconds };
    }
  } catch {
    // If Redis fails, fall through to DB check
  }

  // 3. Fallback to PostgreSQL authoritative check
  try {
    const rows = await db
      .select({
        id: sessions.id,
        revoked: sessions.revoked,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          eq(sessions.revoked, false),
          gt(sessions.expiresAt, new Date())
        )
      )
      .limit(1);

    const record = rows[0];
    if (!record) {
      return null;
    }

    // Populate Redis cache asynchronously
    getRedis()
      .set(
        `session:${tokenHash}`,
        JSON.stringify({
          userId: payload.userId,
          email: payload.email,
          expiresAt: record.expiresAt.toISOString(),
          revoked: false,
        }),
        "EX",
        remainingSeconds
      )
      .catch(() => {});

    return { ...payload, remainingSeconds };
  } catch (error) {
    console.error("[Session] DB validation error, relying on token signature:", error);
    return { ...payload, remainingSeconds };
  }
}

/**
 * Explicitly revokes a session (logout).
 */
export async function revokeRegisteredSession(token: string | undefined): Promise<void> {
  if (!token) return;

  const tokenHash = hashSessionToken(token);

  // Invalidate in Redis
  try {
    const redis = getRedis();
    await redis.set(
      `session:${tokenHash}`,
      JSON.stringify({ revoked: true }),
      "EX",
      60 * 60 * 24 // Keep revoked tombstone for 24h
    );
  } catch (error) {
    console.warn("[Session] Failed to mark session revoked in Redis:", error);
  }

  // Invalidate in PostgreSQL
  try {
    await db.update(sessions).set({ revoked: true }).where(eq(sessions.tokenHash, tokenHash));
  } catch (error) {
    console.error("[Session] Failed to revoke session in DB:", error);
  }
}

/**
 * Revoke all active sessions for a user (e.g. password reset or security breach).
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  try {
    await db.update(sessions).set({ revoked: true }).where(eq(sessions.userId, userId));
  } catch (error) {
    console.error("[Session] Failed to revoke user sessions:", error);
  }
}

export { sessionCookieOptions, SESSION_COOKIE };
