import { Redis } from "ioredis";
import { env } from "@trackme/config";

let client: Redis | null = null;

function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
  }
  return client;
}

export type ActivePageSnapshot = {
  path: string;
  visitors: number;
  countries: string[];
};

export type RealtimeSnapshot = {
  activeVisitors: number;
  pages: ActivePageSnapshot[];
};

type ActiveSessionPayload = {
  path?: string;
  timestamp?: string;
  country?: string;
  device?: string;
};

async function activeSessionIds(siteId: string): Promise<string[]> {
  const redis = getRedis();
  const indexKey = `rt:active:${siteId}`;
  const now = Math.floor(Date.now() / 1000);

  // Prune expired members, then read the live set.
  await redis.zremrangebyscore(indexKey, "-inf", now);
  return redis.zrangebyscore(indexKey, now, "+inf");
}

/**
 * Live snapshot of active sessions for a site.
 * Prefers the ZSET index written by the event worker; falls back to SCAN
 * for sessions written before the index existed.
 */
export async function getRealtimeSnapshot(siteId: string): Promise<RealtimeSnapshot> {
  const redis = getRedis();
  let sessionIds = await activeSessionIds(siteId);

  // Legacy fallback while old keys without an index still expire naturally.
  if (sessionIds.length === 0) {
    const keys = await scanActiveKeys(siteId);
    if (keys.length === 0) {
      return { activeVisitors: 0, pages: [] };
    }
    const values = await redis.mget(...keys);
    return buildSnapshotFromValues(values);
  }

  const keys = sessionIds.map((sid) => `active:${siteId}:${sid}`);
  const values = await redis.mget(...keys);
  return buildSnapshotFromValues(values);
}

function buildSnapshotFromValues(values: (string | null)[]): RealtimeSnapshot {
  const byPath = new Map<string, { visitors: number; countries: Set<string> }>();
  let active = 0;

  for (const raw of values) {
    if (!raw) continue;
    active += 1;
    try {
      const parsed = JSON.parse(raw) as ActiveSessionPayload;
      const path = parsed.path ?? "(unknown)";
      const entry = byPath.get(path) ?? { visitors: 0, countries: new Set<string>() };
      entry.visitors += 1;
      if (parsed.country?.trim()) {
        entry.countries.add(parsed.country.trim());
      }
      byPath.set(path, entry);
    } catch {
      // Skip malformed entries.
    }
  }

  const pages = Array.from(byPath.entries())
    .map(([path, entry]) => ({
      path,
      visitors: entry.visitors,
      countries: Array.from(entry.countries),
    }))
    .sort((a, b) => b.visitors - a.visitors);

  return { activeVisitors: active, pages };
}

async function scanActiveKeys(siteId: string): Promise<string[]> {
  const redis = getRedis();
  const pattern = `active:${siteId}:*`;
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    keys.push(...batch);
    cursor = nextCursor;
  } while (cursor !== "0");

  return keys;
}

export async function getActiveVisitorCount(siteId: string): Promise<number> {
  const redis = getRedis();
  const indexKey = `rt:active:${siteId}`;
  const now = Math.floor(Date.now() / 1000);
  await redis.zremrangebyscore(indexKey, "-inf", now);
  const count = await redis.zcount(indexKey, now, "+inf");
  if (count > 0) return count;

  const keys = await scanActiveKeys(siteId);
  return keys.length;
}
