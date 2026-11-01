import { createHash } from "node:crypto";
import { db, sessions, users, eq, and, gt } from "@trackme/db";
import { env } from "@trackme/config";
import { getRedis } from "./redis";
import {
  SESSION_COOKIE,
  signSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  type SessionPayload,
} from "./session";
import {
  isIssuedBeforeValidAfter,
  parseValidAfterUnix,
  sessionsValidAfterKey,
} from "./session-policy";

export const SESSION_SHORT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const SESSION_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export class SessionStoreUnavailableError extends Error {
  constructor(message = "Session store is temporarily unavailable") {
    super(message);
    this.name = "SessionStoreUnavailableError";
  }
}

export class SessionPersistError extends Error {
  constructor(message = "Could not persist session") {
    super(message);
    this.name = "SessionPersistError";
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type RegisteredSessionResult = {
  token: string;
  expiresAt: Date;
  maxAgeSeconds: number;
};

function sessionCacheKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Creates a server-tracked session. PostgreSQL is mandatory; Redis is a cache.
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
    throw new SessionPersistError();
  }

  try {
    const redis = getRedis("state");
    const pipeline = redis.pipeline();
    pipeline.set(
      sessionCacheKey(tokenHash),
      JSON.stringify({
        userId: params.userId,
        email: params.email,
        expiresAt: expiresAt.toISOString(),
        revoked: false,
      }),
      "EX",
      ttlSeconds
    );
    pipeline.setnx(sessionsValidAfterKey(params.userId), "0");
    await pipeline.exec();
  } catch (error) {
    console.warn("[Session] Failed to cache session in Redis:", error);
  }

  return {
    token,
    expiresAt,
    maxAgeSeconds: ttlSeconds,
  };
}

type CachedSession = {
  userId?: string;
  email?: string;
  expiresAt?: string;
  revoked?: boolean;
};

/**
 * Validates a session token against Redis and PostgreSQL.
 * Fail closed when both the cache miss and the database are unreachable.
 */
export async function validateRegisteredSession(
  token: string | undefined
): Promise<(SessionPayload & { remainingSeconds: number }) | null> {
  if (!token) return null;

  const payload = await verifySessionToken(token, env.NEXTAUTH_SECRET);
  if (!payload) return null;

  const tokenHash = hashSessionToken(token);
  const now = Math.floor(Date.now() / 1000);
  const remainingSeconds = Math.max(0, payload.exp - now);
  if (remainingSeconds <= 0) {
    return null;
  }

  const svaKey = sessionsValidAfterKey(payload.userId);
  const redisKey = sessionCacheKey(tokenHash);

  let cachedSession: string | null = null;
  let cachedSva: string | null = null;
  let redisRead = false;
  try {
    const redis = getRedis("state");
    const [sessionRaw, svaRaw] = await redis.mget(redisKey, svaKey);
    cachedSession = sessionRaw ?? null;
    cachedSva = svaRaw ?? null;
    redisRead = true;
  } catch {
    redisRead = false;
  }

  if (redisRead && cachedSession) {
    let data: CachedSession = {};
    try {
      data = JSON.parse(cachedSession) as CachedSession;
    } catch {
      data = {};
    }
    if (data.revoked === true) {
      return null;
    }

    const svaFromCache = parseValidAfterUnix(cachedSva);
    if (svaFromCache != null) {
      if (isIssuedBeforeValidAfter(payload.iat, svaFromCache)) {
        return null;
      }
      return { ...payload, remainingSeconds };
    }

    try {
      const sva = await loadSessionsValidAfter(payload.userId);
      if (isIssuedBeforeValidAfter(payload.iat, sva)) {
        return null;
      }
      await rememberValidAfter(payload.userId, sva);
      return { ...payload, remainingSeconds };
    } catch {
      throw new SessionStoreUnavailableError();
    }
  }

  try {
    const rows = await db
      .select({
        revoked: sessions.revoked,
        expiresAt: sessions.expiresAt,
        sessionsValidAfter: users.sessionsValidAfter,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
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

    const sva = unixSeconds(record.sessionsValidAfter);
    if (isIssuedBeforeValidAfter(payload.iat, sva)) {
      return null;
    }

    try {
      const redis = getRedis("state");
      const pipeline = redis.pipeline();
      pipeline.set(
        redisKey,
        JSON.stringify({
          userId: payload.userId,
          email: payload.email,
          expiresAt: record.expiresAt.toISOString(),
          revoked: false,
        }),
        "EX",
        remainingSeconds
      );
      pipeline.set(svaKey, String(sva));
      await pipeline.exec();
    } catch {
      // Postgres is authoritative; a cache write failure must not reject a valid session.
    }

    return { ...payload, remainingSeconds };
  } catch (error) {
    if (error instanceof SessionStoreUnavailableError) {
      throw error;
    }
    console.error("[Session] DB validation error:", error);
    throw new SessionStoreUnavailableError();
  }
}

async function loadSessionsValidAfter(userId: string): Promise<number> {
  const rows = await db
    .select({ sessionsValidAfter: users.sessionsValidAfter })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return 0;
  }
  return unixSeconds(row.sessionsValidAfter);
}

async function rememberValidAfter(userId: string, sva: number): Promise<void> {
  try {
    await getRedis("state").set(sessionsValidAfterKey(userId), String(sva));
  } catch {
    // best-effort cache
  }
}

export async function revokeRegisteredSession(token: string | undefined): Promise<void> {
  if (!token) return;

  const tokenHash = hashSessionToken(token);

  try {
    await db.update(sessions).set({ revoked: true }).where(eq(sessions.tokenHash, tokenHash));
  } catch (error) {
    console.error("[Session] Failed to revoke session in DB:", error);
    throw new SessionStoreUnavailableError("Could not revoke session");
  }

  try {
    const redis = getRedis("state");
    await redis.set(sessionCacheKey(tokenHash), JSON.stringify({ revoked: true }), "EX", 60 * 60 * 24);
  } catch (error) {
    console.warn("[Session] Failed to mark session revoked in Redis:", error);
  }
}

/**
 * Revoke all active sessions for a user (password reset or security event).
 * Postgres is updated first; Redis then carries the "valid after" marker.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ sessionsValidAfter: now, updatedAt: now }).where(eq(users.id, userId));
      await tx.update(sessions).set({ revoked: true }).where(eq(sessions.userId, userId));
    });
  } catch (error) {
    console.error("[Session] Failed to revoke user sessions:", error);
    throw new SessionStoreUnavailableError("Could not revoke sessions");
  }

  try {
    await getRedis("state").set(sessionsValidAfterKey(userId), String(unixSeconds(now)));
  } catch (error) {
    console.warn("[Session] Failed to publish sessions_valid_after to Redis:", error);
  }
}

export { sessionCookieOptions, SESSION_COOKIE };
