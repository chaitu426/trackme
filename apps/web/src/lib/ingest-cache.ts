import { Redis } from "ioredis";
import { env } from "@trackme/config";

let client: Redis | null = null;

function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return client;
}

/** Notify Go/Node ingest to drop cached site settings (payload = public_key_hash). */
export async function invalidateIngestSiteCache(publicKeyHash: string): Promise<void> {
  if (!publicKeyHash) return;
  try {
    await getRedis().publish("site:invalidate", publicKeyHash);
  } catch (error) {
    console.warn("site:invalidate publish failed", error);
  }
}
