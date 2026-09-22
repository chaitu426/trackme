import { Redis } from "ioredis";
import { EnrichedEvent } from "@trackme/contracts";

const ACTIVE_SESSION_TTL_SECONDS = 300; // 5 minutes

/**
 * Updates Redis realtime state for active visitors and sessions.
 *
 * Per session: TTL key `active:{siteId}:{sessionId}` holds the payload.
 * Per site index: ZSET `rt:active:{siteId}` scores members by expiry unix
 * so dashboards can ZCARD / ZRANGE without SCAN.
 * Publishes `rt:notify:{siteId}` so SSE hubs refresh without per-client polls.
 */
export async function updateRealtimeState(redis: Redis, events: EnrichedEvent[]): Promise<void> {
  const pipeline = redis.pipeline();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ACTIVE_SESSION_TTL_SECONDS;
  const notifySites = new Set<string>();

  for (const event of events) {
    if (event.isBot) continue;

    const key = `active:${event.siteId}:${event.sessionId}`;
    const indexKey = `rt:active:${event.siteId}`;
    const payload = JSON.stringify({
      path: event.path,
      timestamp: event.occurredAt,
      country: event.country,
      device: event.device,
    });

    pipeline.set(key, payload, "EX", ACTIVE_SESSION_TTL_SECONDS);
    pipeline.zadd(indexKey, expiresAt, event.sessionId);
    pipeline.zremrangebyscore(indexKey, "-inf", now);
    pipeline.expire(indexKey, ACTIVE_SESSION_TTL_SECONDS + 60);
    notifySites.add(event.siteId);
  }

  for (const siteId of notifySites) {
    pipeline.publish(`rt:notify:${siteId}`, "1");
  }

  await pipeline.exec();
}
