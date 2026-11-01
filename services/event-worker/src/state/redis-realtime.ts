import { Redis } from "ioredis";
import { EnrichedEvent } from "@trackme/contracts";

const ACTIVE_SESSION_TTL_SECONDS = 300; // 5 minutes

type RealtimeEvent = Pick<EnrichedEvent, "siteId" | "sessionId" | "occurredAt" | "path" | "country" | "device" | "isBot">;

/** The slice of an ioredis pipeline used here, so tests can record commands. */
export interface RealtimePipeline {
  set(key: string, value: string, mode: "EX", seconds: number): unknown;
  zadd(key: string, ...args: (string | number)[]): unknown;
  zremrangebyscore(key: string, min: string | number, max: string | number): unknown;
  expire(key: string, seconds: number): unknown;
  publish(channel: string, message: string): unknown;
}

/**
 * Collapse a batch to the newest event per (site, session): only the latest page
 * of a session is shown, so earlier events in the same batch are dead writes.
 * Bots are never shown in realtime.
 */
export function latestPerSession(events: RealtimeEvent[]): Map<string, Map<string, RealtimeEvent>> {
  const bySite = new Map<string, Map<string, RealtimeEvent>>();
  for (const event of events) {
    if (event.isBot) continue;
    let sessions = bySite.get(event.siteId);
    if (!sessions) {
      sessions = new Map();
      bySite.set(event.siteId, sessions);
    }
    const prev = sessions.get(event.sessionId);
    if (!prev || Date.parse(event.occurredAt) >= Date.parse(prev.occurredAt)) {
      sessions.set(event.sessionId, event);
    }
  }
  return bySite;
}

/** Queue every realtime command for a batch. Exported so the command count is testable. */
export function queueRealtimeCommands(pipeline: RealtimePipeline, events: RealtimeEvent[], nowSeconds: number): void {
  const expiresAt = nowSeconds + ACTIVE_SESSION_TTL_SECONDS;

  for (const [siteId, sessions] of latestPerSession(events)) {
    const indexKey = `rt:active:${siteId}`;
    const members: (string | number)[] = [];

    for (const [sessionId, event] of sessions) {
      pipeline.set(
        `active:${siteId}:${sessionId}`,
        JSON.stringify({
          path: event.path,
          timestamp: event.occurredAt,
          country: event.country,
          device: event.device,
        }),
        "EX",
        ACTIVE_SESSION_TTL_SECONDS
      );
      members.push(expiresAt, sessionId);
    }

    // One multi-member ZADD, trim and expire per site instead of per event.
    pipeline.zadd(indexKey, ...members);
    pipeline.zremrangebyscore(indexKey, "-inf", nowSeconds);
    pipeline.expire(indexKey, ACTIVE_SESSION_TTL_SECONDS + 60);
    pipeline.publish(`rt:notify:${siteId}`, "1");
  }
}

/**
 * Updates Redis realtime state for active visitors and sessions.
 *
 * Per session: TTL key `active:{siteId}:{sessionId}` holds the payload.
 * Per site index: ZSET `rt:active:{siteId}` scores members by expiry unix
 * so dashboards can ZCARD / ZRANGE without SCAN.
 * Publishes `rt:notify:{siteId}` so SSE hubs refresh without per-client polls.
 *
 * Commands per batch: 1 per active session + 4 per site (was 4 per event).
 */
export async function updateRealtimeState(redis: Redis, events: EnrichedEvent[]): Promise<void> {
  const pipeline = redis.pipeline();
  queueRealtimeCommands(pipeline as unknown as RealtimePipeline, events, Math.floor(Date.now() / 1000));
  await pipeline.exec();
}
