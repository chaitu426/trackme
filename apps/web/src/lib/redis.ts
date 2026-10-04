import { Redis } from "ioredis";
import { env } from "@trackme/config";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      lazyConnect: false,
    });

    client.on("error", (err) => {
      console.warn("[Redis] Connection error:", err.message);
    });
  }
  return client;
}

export { client as redisClient };
