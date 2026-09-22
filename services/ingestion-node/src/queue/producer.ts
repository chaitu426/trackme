import { Redis } from "ioredis";
import { env } from "@trackme/config";
import type { EnrichedEvent } from "@trackme/contracts";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
  }
  return redisClient;
}

const STREAM_MAX_LEN = 1_000_000;

/**
 * Publish a batch of enriched events to the Redis stream queue
 */
export async function publishBatchToQueue(events: EnrichedEvent[]): Promise<void> {
  const redis = getRedisClient();
  const streamName = env.QUEUE_NAME;

  const pipeline = redis.pipeline();

  for (const event of events) {
    pipeline.xadd(
      streamName,
      "MAXLEN",
      "~",
      STREAM_MAX_LEN,
      "*", // Let Redis assign ID
      "payload",
      JSON.stringify(event)
    );
  }

  const results = await pipeline.exec();
  if (!results) {
    throw new Error("Redis pipeline returned no results while publishing events");
  }

  for (const [error] of results) {
    if (error) {
      throw error;
    }
  }
}
