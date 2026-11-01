import assert from "node:assert/strict";
import test from "node:test";
import type { MetricQueryRequest } from "@trackme/contracts";
import { cacheKey, cached, normalizeRange, ttlSecondsFor, type CacheStore } from "./query-cache";

const NOW = Date.parse("2026-03-10T12:34:56.789Z");

function memoryStore(): CacheStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
  };
}

const request = (from: string, to: string): MetricQueryRequest => ({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
  dateRange: { from, to, granularity: "day" },
  limit: 50,
  offset: 0,
});

test("a rolling short range is floored to the minute so reloads share a key", () => {
  const a = normalizeRange({ from: "2026-03-09T12:34:56.789Z", to: "2026-03-10T12:34:56.789Z" }, NOW);
  assert.deepEqual(a, { from: "2026-03-09T12:34:00.000Z", to: "2026-03-10T12:34:00.000Z" });
});

test("a rolling long range is floored to 5 minutes", () => {
  const a = normalizeRange({ from: "2026-02-08T12:34:56.789Z", to: "2026-03-10T12:34:56.789Z" }, NOW);
  assert.equal(a.to, "2026-03-10T12:30:00.000Z");
});

test("a closed historical range is left exact so its last milliseconds are not dropped", () => {
  const r = { from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.999Z" };
  assert.deepEqual(normalizeRange(r, NOW), r);
});

test("live ranges get a short TTL, historical a long one", () => {
  assert.equal(ttlSecondsFor(NOW, NOW), 30);
  assert.equal(ttlSecondsFor(NOW - 86_400_000, NOW), 900);
});

test("keys differ by site, filters and endpoint", () => {
  const base = request("2026-02-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z");
  const other = { ...base, siteId: "33333333-3333-4333-8333-333333333333" };
  const filtered = { ...base, filters: { country: "US" } };
  assert.notEqual(cacheKey("overview", base), cacheKey("overview", other));
  assert.notEqual(cacheKey("overview", base), cacheKey("overview", filtered));
  assert.notEqual(cacheKey("overview", base), cacheKey("breakdown", base));
  assert.notEqual(cacheKey("breakdown", base, "path"), cacheKey("breakdown", base, "os"));
  assert.ok(cacheKey("overview", base).includes(base.siteId));
});

test("a second call is served from cache without running the query", async () => {
  const store = memoryStore();
  let runs = 0;
  const fn = async () => ({ n: ++runs });
  assert.deepEqual(await cached("k", 30, fn, store), { n: 1 });
  assert.deepEqual(await cached("k", 30, fn, store), { n: 1 });
  assert.equal(runs, 1);
});

test("concurrent identical queries are coalesced into one", async () => {
  const store = memoryStore();
  let runs = 0;
  const fn = async () => {
    runs++;
    await new Promise((r) => setTimeout(r, 20));
    return runs;
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => cached("sf", 30, fn, store)));
  assert.equal(runs, 1);
  assert.ok(results.every((r) => r === 1));
});

test("an error is not cached and the next call retries", async () => {
  const store = memoryStore();
  let runs = 0;
  const fn = async () => {
    runs++;
    if (runs === 1) throw new Error("clickhouse down");
    return "ok";
  };
  await assert.rejects(() => cached("e", 30, fn, store), /clickhouse down/);
  assert.equal(store.data.size, 0);
  assert.equal(await cached("e", 30, fn, store), "ok");
});

test("a cache outage degrades to a direct query", async () => {
  const broken: CacheStore = {
    get: async () => {
      throw new Error("redis down");
    },
    set: async () => {
      throw new Error("redis down");
    },
  };
  assert.equal(await cached("x", 30, async () => 42, broken), 42);
});

import { cachedFunnel } from "./query-cache";

const funnelReq = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
  dateRange: { from: "2026-02-08T12:34:56.789Z", to: "2026-03-10T12:34:56.789Z", granularity: "day" as const },
};

test("two loads in the same 5 minutes share one funnel query, and it runs on the normalized range", async () => {
  const store = memoryStore();
  const seen: string[] = [];
  const run = async (r: typeof funnelReq) => (seen.push(r.dateRange.to), { n: seen.length });
  const steps = [{ type: "pageview", value: "/a" }];
  const a = await cachedFunnel(funnelReq, steps, 86400, run, store, NOW);
  const later = { ...funnelReq, dateRange: { ...funnelReq.dateRange, to: "2026-03-10T12:34:59.001Z" } };
  const b = await cachedFunnel(later, steps, 86400, run, store, NOW + 2000);
  assert.deepEqual(a, b);
  assert.deepEqual(seen, ["2026-03-10T12:30:00.000Z"]);
});

test("editing the funnel steps never serves the old definition", async () => {
  const store = memoryStore();
  let runs = 0;
  const run = async () => ++runs;
  await cachedFunnel(funnelReq, [{ type: "pageview", value: "/a" }], 86400, run, store, NOW);
  await cachedFunnel(funnelReq, [{ type: "pageview", value: "/b" }], 86400, run, store, NOW);
  assert.equal(runs, 2);
});

test("a funnel outage is not cached", async () => {
  const store = memoryStore();
  await assert.rejects(cachedFunnel(funnelReq, [], 86400, async () => { throw new Error("down"); }, store, NOW));
  assert.equal(store.data.size, 0);
});

import { metrics } from "./metrics-registry";

test("cache lookups are counted by endpoint and result", async () => {
  const store = memoryStore();
  const key = "q:v1:metricsprobe:site:abc";
  await cached(key, 30, async () => 1, store);
  await cached(key, 30, async () => 1, store);
  const text = await metrics.registry.metrics();
  assert.match(text, /query_cache_total\{endpoint="metricsprobe",result="miss"\} 1/);
  assert.match(text, /query_cache_total\{endpoint="metricsprobe",result="hit"\} 1/);
});

test("an expired entry is served stale at once and refreshed once in the background", async () => {
  const store = memoryStore();
  let calls = 0;
  const run = async () => ({ n: ++calls });
  assert.deepEqual(await cached("swr", 30, run, store), { n: 1 });

  // Age the entry past its freshness window but keep it in the store (inside the grace period).
  const entry = JSON.parse(store.data.get("swr")!);
  entry.fresh = Date.now() - 1000;
  store.data.set("swr", JSON.stringify(entry));

  assert.deepEqual(await cached("swr", 30, run, store), { n: 1 }, "stale value answers immediately");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 2, "exactly one background refresh ran");
  assert.deepEqual(await cached("swr", 30, run, store), { n: 2 }, "next read sees the refreshed value");
});

test("a failed background refresh keeps serving the stale value", async () => {
  const store = memoryStore();
  await cached("swr-fail", 30, async () => "old", store);
  const entry = JSON.parse(store.data.get("swr-fail")!);
  entry.fresh = Date.now() - 1000;
  store.data.set("swr-fail", JSON.stringify(entry));

  const value = await cached("swr-fail", 30, async () => { throw new Error("clickhouse down"); }, store);
  assert.equal(value, "old");
});
