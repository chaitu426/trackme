import { createHash } from "node:crypto";
import type { MetricQueryRequest } from "@trackme/contracts";
import { recordCache } from "./metrics-registry";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SHORT_RANGE_MS = 48 * HOUR_MS;
const LIVE_WINDOW_MS = 5 * MINUTE_MS;
const LIVE_TTL_SECONDS = 30;
const HISTORICAL_TTL_SECONDS = 15 * 60;

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

// Loaded lazily: ./redis connects at import time, which tests must not trigger.
async function cacheRedis() {
  return (await import("./redis")).getRedis("cache");
}

const redisStore: CacheStore = {
  get: async (key) => (await cacheRedis()).get(key),
  set: async (key, value, ttl) => {
    await (await cacheRedis()).set(key, value, "EX", ttl);
  },
};

/** A range is "live" when it ends at (or near) now, i.e. it is a rolling window. */
export function isLiveRange(toMs: number, nowMs: number): boolean {
  return toMs >= nowMs - LIVE_WINDOW_MS;
}

/**
 * Round a rolling range so repeated loads share a key and a result: floor to the
 * minute for ranges up to 48 h and to 5 minutes beyond. Ranges that end in the
 * past are left exact, otherwise flooring `to` would drop the tail of a closed day.
 */
export function normalizeRange(
  range: { from: string; to: string },
  nowMs: number = Date.now()
): { from: string; to: string } {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  if (!isLiveRange(toMs, nowMs)) return { from: range.from, to: range.to };
  const bucket = toMs - fromMs <= SHORT_RANGE_MS ? MINUTE_MS : 5 * MINUTE_MS;
  const floor = (ms: number) => new Date(Math.floor(ms / bucket) * bucket).toISOString();
  return { from: floor(fromMs), to: floor(toMs) };
}

export function ttlSecondsFor(toMs: number, nowMs: number = Date.now()): number {
  return isLiveRange(toMs, nowMs) ? LIVE_TTL_SECONDS : HISTORICAL_TTL_SECONDS;
}

/** Return the request with its range normalized; query with this, not the original, so key and result agree. */
export function normalizeRequest(request: MetricQueryRequest, nowMs: number = Date.now()): MetricQueryRequest {
  return { ...request, dateRange: { ...request.dateRange, ...normalizeRange(request.dateRange, nowMs) } };
}

export function cacheKey(endpoint: string, request: MetricQueryRequest, extra = ""): string {
  const digest = createHash("sha1")
    .update(
      JSON.stringify([
        request.workspaceId,
        request.dateRange,
        request.filters ?? null,
        request.limit,
        request.offset,
        extra,
      ])
    )
    .digest("hex");
  return `q:v1:${endpoint}:${request.siteId}:${digest}`;
}

const FUNNEL_TTL_SECONDS = 5 * 60;

export interface FunnelCacheRequest {
  workspaceId: string;
  siteId: string;
  dateRange: { from: string; to: string; granularity: "minute" | "hour" | "day" | "month" };
}

/**
 * Funnels are not live numbers, so they get a 5 minute TTL. The key covers the
 * steps and window, so editing a funnel never serves the old definition. Callers
 * must authorize before calling. Errors are not cached (see cached()).
 */
export async function cachedFunnel<T, R extends FunnelCacheRequest>(
  request: R,
  steps: unknown,
  windowSeconds: number,
  run: (normalized: R) => Promise<T>,
  store?: CacheStore,
  nowMs: number = Date.now()
): Promise<T> {
  return cachedFunnelKind("funnel", request, steps, windowSeconds, run, store, nowMs);
}

/** Like cachedFunnel, for another read over the same funnel (`kind` keeps their entries apart). */
export async function cachedFunnelKind<T, R extends FunnelCacheRequest>(
  kind: string,
  request: R,
  steps: unknown,
  windowSeconds: number,
  run: (normalized: R) => Promise<T>,
  store?: CacheStore,
  nowMs: number = Date.now()
): Promise<T> {
  const range = normalizeRange(request.dateRange, nowMs);
  const normalized: R = { ...request, dateRange: { ...request.dateRange, ...range } };
  const digest = createHash("sha1")
    .update(JSON.stringify([normalized.workspaceId, normalized.dateRange, steps, windowSeconds]))
    .digest("hex");
  const key = `q:v1:${kind}:${normalized.siteId}:${digest}`;
  return cached(key, FUNNEL_TTL_SECONDS, () => run(normalized), store);
}

const inflight = new Map<string, Promise<unknown>>();

/** How long past its TTL an entry may still be served while a refresh runs behind it. */
const STALE_GRACE_SECONDS = 10 * 60;

interface Envelope<T> {
  swr: 1;
  /** Epoch ms until which the value is fresh. */
  fresh: number;
  data: T;
}

function readEnvelope<T>(raw: string): { data: T; fresh: number } {
  const parsed = JSON.parse(raw) as Envelope<T> | T;
  if (parsed && typeof parsed === "object" && (parsed as Envelope<T>).swr === 1) {
    const envelope = parsed as Envelope<T>;
    return { data: envelope.data, fresh: envelope.fresh };
  }
  // Entry written before envelopes existed: treat as fresh, it expires by its own TTL.
  return { data: parsed as T, fresh: Number.POSITIVE_INFINITY };
}

function load<T>(key: string, ttlSeconds: number, fn: () => Promise<T>, store: CacheStore): Promise<T> {
  const pending = inflight.get(key);
  if (pending) {
    recordCache(key, "coalesced");
    return pending as Promise<T>;
  }
  recordCache(key, "miss");

  const promise = fn()
    .then(async (value) => {
      try {
        const envelope: Envelope<T> = { swr: 1, fresh: Date.now() + ttlSeconds * 1000, data: value };
        await store.set(key, JSON.stringify(envelope), ttlSeconds + STALE_GRACE_SECONDS);
      } catch {
        // best effort
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/**
 * Read-through cache with single-flight and stale-while-revalidate. A fresh hit is
 * returned as is; a hit past its TTL (but inside the grace window) is returned
 * immediately while one background refresh updates it, so a dashboard reload never
 * waits on ClickHouse once a key has been warmed. Callers must authorize BEFORE
 * calling, so a hit never bypasses access control. Errors are never cached, and a
 * cache outage degrades to a direct query instead of failing the request.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  store: CacheStore = redisStore
): Promise<T> {
  try {
    const hit = await store.get(key);
    if (hit !== null) {
      const { data, fresh } = readEnvelope<T>(hit);
      if (Date.now() < fresh) {
        recordCache(key, "hit");
        return data;
      }
      recordCache(key, "stale");
      void load(key, ttlSeconds, fn, store).catch(() => {
        // the stale value already answered the request; the next one retries
      });
      return data;
    }
  } catch {
    recordCache(key, "error");
    // cache unavailable: fall through to the source of truth
  }

  return load(key, ttlSeconds, fn, store);
}
