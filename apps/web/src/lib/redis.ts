import { Redis } from "ioredis";
import { getRedisURLForRole, type RedisRole } from "@trackme/config";

const clients = new Map<RedisRole, Redis>();

export function getRedis(role: RedisRole = "state"): Redis {
  const existing = clients.get(role);
  if (existing) return existing;

  const client = new Redis(getRedisURLForRole(role), {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    lazyConnect: false,
  });

  client.on("error", (err) => {
    console.warn(`[Redis:${role}] Connection error:`, err.message);
  });

  clients.set(role, client);
  return client;
}

export const redisClient = getRedis("state");
