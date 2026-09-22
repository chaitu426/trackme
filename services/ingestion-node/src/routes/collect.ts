import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as Contracts from "@trackme/contracts";
import type { EnrichedEvent, SiteSettings } from "@trackme/contracts";
import { hashApiKey } from "@trackme/authz";
import * as DB from "@trackme/db";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { extractGeoFromHeaders, sanitizeUrl, isLocalOrFileUrl } from "../middleware/privacy.js";
import { classifyRequest } from "../middleware/bot-detection.js";
import { publishBatchToQueue } from "../queue/producer.js";

type CachedSite = {
  id: string;
  workspaceId: string;
  domain: string;
  monthlyEventQuota: number;
  settings: SiteSettings;
  cachedAt: number;
};

const SITE_CACHE_TTL_MS = 60_000;
const SITE_CACHE_MAX = 5_000;
/** Cache keyed by public_key_hash */
const siteCache = new Map<string, CachedSite>();

let redis: Redis | null = null;
let invalidateSub: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    ensureInvalidateListener();
  }
  return redis;
}

function ensureInvalidateListener(): void {
  if (invalidateSub) return;
  invalidateSub = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  void invalidateSub.subscribe("site:invalidate");
  invalidateSub.on("message", (_channel, hash) => {
    if (hash) siteCache.delete(hash);
  });
}

const tryReserveScript = `
local key = KEYS[1]
local quota = tonumber(ARGV[1])
local delta = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local current = tonumber(redis.call('GET', key) or '0')
if quota > 0 and (current + delta) > quota then
  return 0
end
redis.call('INCRBY', key, delta)
redis.call('EXPIRE', key, ttl)
return 1
`;

async function tryReserveQuota(
  workspaceId: string,
  quota: number,
  delta: number
): Promise<boolean> {
  if (delta <= 0) return true;
  const key = usageKey(workspaceId);
  const ttl = 40 * 24 * 60 * 60;
  const allowed = await getRedis().eval(tryReserveScript, 1, key, quota, delta, ttl);
  return Number(allowed) === 1;
}

async function releaseQuota(reserved: Map<string, number>): Promise<void> {
  if (reserved.size === 0) return;
  const pipe = getRedis().pipeline();
  for (const [workspaceId, delta] of reserved) {
    if (delta > 0) pipe.decrby(usageKey(workspaceId), delta);
  }
  await pipe.exec();
}

function parseSiteSettings(raw: unknown): SiteSettings {
  const parsed = Contracts.SiteSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : Contracts.SiteSettingsSchema.parse({});
}

function trimSiteCache(): void {
  if (siteCache.size <= SITE_CACHE_MAX) return;
  const overflow = siteCache.size - SITE_CACHE_MAX;
  const keys = siteCache.keys();
  for (let i = 0; i < overflow; i++) {
    const key = keys.next().value;
    if (key) siteCache.delete(key);
  }
}

function hostAllowed(eventUrl: string, siteDomain: string, allowLocalhost: boolean): boolean {
  if (allowLocalhost && isLocalOrFileUrl(eventUrl)) return true;
  try {
    const host = new URL(eventUrl).hostname.toLowerCase();
    const domain = siteDomain.trim().toLowerCase();
    if (!domain) return true;
    if (host === domain || host.endsWith(`.${domain}`)) return true;
    if (domain === "localhost" && (host === "localhost" || host === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

async function getSiteByPublicKey(publicKey: string): Promise<CachedSite | null> {
  const hash = hashApiKey(publicKey);
  const cached = siteCache.get(hash);
  if (cached && Date.now() - cached.cachedAt < SITE_CACHE_TTL_MS) {
    return cached;
  }

  const result = await DB.db
    .select({
      id: DB.sites.id,
      workspaceId: DB.sites.workspaceId,
      domain: DB.sites.domain,
      settings: DB.sites.settings,
      monthlyEventQuota: DB.workspaces.monthlyEventQuota,
    })
    .from(DB.sites)
    .innerJoin(DB.workspaces, DB.eq(DB.workspaces.id, DB.sites.workspaceId))
    .where(DB.eq(DB.sites.publicKeyHash, hash))
    .limit(1);

  if (result.length > 0 && result[0]) {
    const entry: CachedSite = {
      id: result[0].id,
      workspaceId: result[0].workspaceId,
      domain: result[0].domain,
      monthlyEventQuota: result[0].monthlyEventQuota,
      settings: parseSiteSettings(result[0].settings),
      cachedAt: Date.now(),
    };
    siteCache.set(hash, entry);
    trimSiteCache();
    return entry;
  }

  siteCache.delete(hash);
  return null;
}

function usageKey(workspaceId: string): string {
  const period = new Date().toISOString().slice(0, 7);
  return `usage:${workspaceId}:${period}`;
}

function enrichEvent(
  ev: Contracts.TrackerEvent,
  site: CachedSite,
  request: FastifyRequest,
  receivedAt: string
): EnrichedEvent | { rejected: string } {
  if (!site.settings.allowLocalhostTracking && isLocalOrFileUrl(ev.url)) {
    return { rejected: "Localhost / file tracking is disabled for this site" };
  }

  if (site.settings.respectDoNotTrack && request.headers.dnt === "1") {
    return { rejected: "Do Not Track is enabled" };
  }

  if (ev.type === "web_vital" && !site.settings.collectWebVitals) {
    return { rejected: "Web vitals collection is disabled for this site" };
  }

  if (!hostAllowed(ev.url, site.domain, site.settings.allowLocalhostTracking)) {
    return { rejected: "Event host does not match registered site domain" };
  }

  const userAgent = request.headers["user-agent"];
  const geo = extractGeoFromHeaders(request.headers as Record<string, string | string[] | undefined>);
  const classification = classifyRequest(userAgent);
  const { sanitizedUrl, sanitizedPath } = sanitizeUrl(ev.url);

  return {
    ...ev,
    url: sanitizedUrl,
    path: sanitizedPath,
    workspaceId: site.workspaceId,
    siteId: site.id,
    receivedAt,
    country: geo.country,
    city: geo.city,
    browser: classification.browser,
    os: classification.os,
    device: classification.device,
    isBot: classification.isBot,
    botStatus: classification.botStatus,
  };
}

export async function registerCollectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/v1/batch",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = Contracts.IngestionBatchRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid tracker payload",
          details: parsed.error.errors,
        });
      }

      const { events } = parsed.data;
      const resolvedSites = new Map<string, CachedSite>();

      for (const ev of events) {
        let site = resolvedSites.get(ev.siteKey);
        if (!site) {
          const lookedUp = await getSiteByPublicKey(ev.siteKey);
          if (!lookedUp) {
            return reply.status(401).send({
              error: "Unknown or invalid site key",
            });
          }
          site = lookedUp;
          resolvedSites.set(ev.siteKey, site);
        }
      }

      const receivedAt = new Date().toISOString();
      const enrichedEvents: EnrichedEvent[] = [];

      for (const ev of events) {
        const site = resolvedSites.get(ev.siteKey)!;
        const result = enrichEvent(ev, site, request, receivedAt);
        if ("rejected" in result) {
          continue;
        }
        enrichedEvents.push(result);
      }

      if (enrichedEvents.length === 0) {
        return reply.status(202).send({
          status: "accepted",
          processed: 0,
        });
      }

      const byWorkspace = new Map<string, { quota: number; count: number }>();
      for (const ev of enrichedEvents) {
        const site = [...resolvedSites.values()].find((s) => s.id === ev.siteId);
        const entry = byWorkspace.get(ev.workspaceId) ?? {
          quota: site?.monthlyEventQuota ?? 0,
          count: 0,
        };
        entry.count += 1;
        byWorkspace.set(ev.workspaceId, entry);
      }

      const reserved = new Map<string, number>();
      for (const [workspaceId, { quota, count }] of byWorkspace) {
        if (!(await tryReserveQuota(workspaceId, quota, count))) {
          await releaseQuota(reserved);
          return reply.status(402).send({ error: "Monthly event quota exceeded" });
        }
        reserved.set(workspaceId, count);
      }

      try {
        await publishBatchToQueue(enrichedEvents);
      } catch (error) {
        await releaseQuota(reserved);
        throw error;
      }

      return reply.status(202).send({
        status: "accepted",
        processed: enrichedEvents.length,
      });
    }
  );

  fastify.post(
    "/v1/e",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = Contracts.TrackerEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid tracker event payload",
          details: parsed.error.errors,
        });
      }

      const ev = parsed.data;
      const site = await getSiteByPublicKey(ev.siteKey);
      if (!site) {
        return reply.status(401).send({
          error: "Unknown or invalid site key",
        });
      }

      const result = enrichEvent(ev, site, request, new Date().toISOString());
      if ("rejected" in result) {
        return reply.status(202).send({ status: "accepted", processed: 0 });
      }

      if (!(await tryReserveQuota(site.workspaceId, site.monthlyEventQuota, 1))) {
        return reply.status(402).send({ error: "Monthly event quota exceeded" });
      }

      try {
        await publishBatchToQueue([result]);
      } catch (error) {
        await releaseQuota(new Map([[site.workspaceId, 1]]));
        throw error;
      }

      return reply.status(202).send({ status: "accepted", processed: 1 });
    }
  );
}
