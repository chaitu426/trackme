import type { CacheStore } from "./query-cache";

const MEMBERSHIP_TTL_SECONDS = 30;
const SITE_TTL_SECONDS = 10 * 60;

export const membershipKey = (userId: string, workspaceId: string) => `authz:${userId}:${workspaceId}`;
export const siteWorkspaceKey = (siteId: string) => `sitews:${siteId}`;

// Loaded lazily: ./redis connects at import time, which tests must not trigger.
async function cacheRedis() {
  return (await import("./redis")).getRedis("cache");
}

export const redisAuthzStore: CacheStore & { del(...keys: string[]): Promise<void> } = {
  get: async (key) => (await cacheRedis()).get(key),
  set: async (key, value, ttl) => {
    await (await cacheRedis()).set(key, value, "EX", ttl);
  },
  del: async (...keys) => {
    await (await cacheRedis()).del(...keys);
  },
};

type AuthzStore = CacheStore & { del(...keys: string[]): Promise<void> };

/**
 * Cached role for a user in a workspace. Only positive results are cached, so
 * granting access takes effect immediately; revoking is covered by explicit
 * invalidation plus the short TTL. Any cache failure falls back to the loader.
 */
export async function cachedMembershipRole(
  userId: string,
  workspaceId: string,
  load: () => Promise<string>,
  store: AuthzStore = redisAuthzStore
): Promise<string> {
  const key = membershipKey(userId, workspaceId);
  try {
    const hit = await store.get(key);
    if (hit) return hit;
  } catch {
    // fall through to the database
  }
  const role = await load();
  try {
    await store.set(key, role, MEMBERSHIP_TTL_SECONDS);
  } catch {
    // best effort
  }
  return role;
}

/** True when the site is known to belong to the workspace; cached positives only. */
export async function cachedSiteInWorkspace(
  siteId: string,
  workspaceId: string,
  load: () => Promise<boolean>,
  store: AuthzStore = redisAuthzStore
): Promise<boolean> {
  const key = siteWorkspaceKey(siteId);
  try {
    const hit = await store.get(key);
    if (hit) return hit === workspaceId;
  } catch {
    // fall through to the database
  }
  const belongs = await load();
  if (belongs) {
    try {
      await store.set(key, workspaceId, SITE_TTL_SECONDS);
    } catch {
      // best effort
    }
  }
  return belongs;
}

/** Call after a role change or removal. Failure is logged: the 30 s TTL bounds the staleness. */
export async function invalidateMembership(
  userId: string,
  workspaceId: string,
  store: AuthzStore = redisAuthzStore
): Promise<void> {
  try {
    await store.del(membershipKey(userId, workspaceId));
  } catch (error) {
    console.warn("authz invalidate failed", error);
  }
}

export async function invalidateSite(siteId: string, store: AuthzStore = redisAuthzStore): Promise<void> {
  try {
    await store.del(siteWorkspaceKey(siteId));
  } catch (error) {
    console.warn("site authz invalidate failed", error);
  }
}
