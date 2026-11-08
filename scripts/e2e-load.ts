/**
 * End-to-end load test for the ingestion pipeline.
 *
 *   setup     create N throwaway sites under the demo workspace
 *   run       staged load against the live ingestion edge, then measure delivery
 *             through Kafka -> event worker -> ClickHouse and Redis realtime
 *   probe     sample Postgres, Redis and ClickHouse latency during the run
 *   baseline  Phase 0 of docs/INGESTION_SCALE_ARCHITECTURE.md: open-loop, Zipf-distributed
 *             load; reconciles acked vs stored per site and prints which findings reproduce
 *   teardown  delete the throwaway sites
 *
 * Usage: npx tsx scripts/e2e-load.ts setup|run|teardown [--sites=N]
 *        npx tsx scripts/e2e-load.ts baseline [--sites=1000 --rps=2000 --seconds=120 --zipf=1.1]
 *   baseline needs TRUSTED_PROXY_HOPS=1 on the edge (it spreads X-Forwarded-For over many IPs).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Redis } from "ioredis";
import { Kafka, logLevel } from "kafkajs";
import { db, inArray, sites, sql } from "@trackme/db";
import { env } from "@trackme/config";
import { hashApiKey } from "@trackme/authz";
import { getClickHouseClient } from "@trackme/analytics";
import { compare, gauge, partsMax, snapshot, viewCost } from "./phase0-probe";

const INGEST_URL = process.env.E2E_INGEST_URL ?? "http://localhost:3001/v1/batch";
const SITES_FILE = path.join(process.cwd(), "scripts/.e2e-sites.json");
const STATE_FILE = path.join(process.cwd(), "scripts/.e2e-state.json");
const DEMO_WORKSPACE_SLUG = "trackme-demo";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type TestSite = { id: string; key: string; domain: string };
const INT = (name: string) => Number.parseInt(name, 10);

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
}

function pct(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function summarize(values: number[]) {
  return {
    n: values.length,
    p50: pct(values, 50),
    p95: pct(values, 95),
    p99: pct(values, 99),
    max: values.length ? Math.max(...values) : null,
  };
}

function metricValue(text: string, name: string, labels = ""): number {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${labels ? `\\{${labels}\\}` : "(?:\\{[^}]*\\})?"}\\s+([\\d.e+-]+)$`, "m");
  const m = re.exec(text);
  return m ? Number(m[1]) : 0;
}

async function scrape(url: string): Promise<{ text: string; values: Record<string, number> }> {
  const text = await (await fetch(url)).text();
  return {
    text,
    values: {
      edge_accepted: metricValue(text, "edge_events_total", 'outcome="accepted"'),
      edge_rejected: metricValue(text, "edge_events_total", 'outcome="rejected"'),
      edge_duplicate: metricValue(text, "edge_events_total", 'outcome="duplicate"'),
      edge_publish_count: metricValue(text, "edge_kafka_publish_duration_seconds_count"),
      edge_publish_sum: metricValue(text, "edge_kafka_publish_duration_seconds_sum"),
      edge_publish_errors: metricValue(text, "edge_kafka_publish_errors_total"),
      edge_redis_errors: metricValue(text, "edge_redis_errors_total"),
      site_cache_hit: metricValue(text, "edge_site_cache_total", 'result="hit"'),
      site_cache_miss: metricValue(text, "edge_site_cache_total", 'result="miss"'),
      worker_stored: metricValue(text, "worker_events_stored_total"),
      worker_insert_count: metricValue(text, "worker_insert_duration_seconds_count"),
      worker_insert_sum: metricValue(text, "worker_insert_duration_seconds_sum"),
      worker_batch_count: metricValue(text, "worker_batch_rows_count"),
      worker_batch_sum: metricValue(text, "worker_batch_rows_sum"),
      worker_dlq: metricValue(text, "worker_dlq_total"),
      worker_realtime_errors: metricValue(text, "worker_realtime_errors_total"),
      worker_v2_errors: metricValue(text, "worker_v2_write_errors_total"),
      worker_lag_p0: Number(/^worker_consumer_lag\{partition="0"\}\s+([\d.]+)$/m.exec(text)?.[1] ?? 0),
      worker_lag_p1: Number(/^worker_consumer_lag\{partition="1"\}\s+([\d.]+)$/m.exec(text)?.[1] ?? 0),
    },
  };
}

function kafkaAdmin() {
  return new Kafka({
    clientId: "e2e-load",
    brokers: env.KAFKA_BROKERS.split(",").map((b) => b.trim()).filter(Boolean),
    logLevel: logLevel.ERROR,
    ssl: env.KAFKA_SSL
      ? env.KAFKA_CA_CERT_PATH
        ? { ca: [fs.readFileSync(env.KAFKA_CA_CERT_PATH, "utf8")] }
        : true
      : undefined,
    sasl: env.KAFKA_SASL_MECHANISM
      ? {
          mechanism: env.KAFKA_SASL_MECHANISM,
          username: env.KAFKA_SASL_USERNAME ?? "",
          password: env.KAFKA_SASL_PASSWORD ?? "",
        }
      : undefined,
  }).admin();
}

async function kafkaState() {
  const admin = kafkaAdmin();
  try {
    await admin.connect();
    const high = await admin.fetchTopicOffsets(env.KAFKA_TOPIC);
    const committed = await admin.fetchOffsets({ groupId: env.KAFKA_CONSUMER_GROUP, topics: [env.KAFKA_TOPIC] });
    const cached = new Map(committed[0]?.partitions.map((p) => [p.partition, p.offset]) ?? []);
    const partitions = high.map((p) => ({
      partition: p.partition,
      high: Number(p.high),
      committed: Number(cached.get(p.partition) ?? -1),
      lag: Number(p.high) - Number(cached.get(p.partition) ?? -1),
    }));
    return { partitions };
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

async function setup(siteCount: number) {
  const workspace = (await db.execute(sql`select id from workspaces where slug = ${DEMO_WORKSPACE_SLUG} limit 1`)) as unknown as {
    rows?: { id: string }[];
  } & { id?: string }[];
  const rows = (workspace as unknown as { rows?: { id: string }[] }).rows ?? (workspace as unknown as { id: string }[]);
  const workspaceId = rows[0]?.id;
  if (!workspaceId) throw new Error(`workspace ${DEMO_WORKSPACE_SLUG} not found`);

  const settings = {
    collectWebVitals: true,
    respectDoNotTrack: false,
    allowLocalhostTracking: false,
    retentionMonths: 24,
    publicDashboardEnabled: false,
    requireOriginMatch: false,
    requireConsent: false,
    signingRequired: false,
  };

  const created: TestSite[] = [];
  for (let start = 0; start < siteCount; start += 200) {
    const batch = Array.from({ length: Math.min(200, siteCount - start) }, (_, j) => {
      const i = start + j;
      const key = `site_pub_e2e_${crypto.randomUUID().replace(/-/g, "")}`;
      return {
        workspaceId,
        domain: `load-${i}.example.com`,
        displayName: `E2E Load ${i}`,
        publicKey: key,
        publicKeyHash: hashApiKey(key),
        settings,
      };
    });
    const inserted = await db
      .insert(sites)
      .values(batch)
      .returning({ id: sites.id, publicKey: sites.publicKey, domain: sites.domain });
    created.push(...inserted.map((s) => ({ id: s.id, key: s.publicKey, domain: s.domain })));
    process.stdout.write(`\rcreated ${created.length}/${siteCount} sites`);
  }
  fs.writeFileSync(SITES_FILE, JSON.stringify(created, null, 2));
  console.log(`\nwrote ${SITES_FILE}`);
  process.exit(0);
}

async function teardown() {
  if (!fs.existsSync(SITES_FILE)) {
    console.log("nothing to tear down");
    return;
  }
  const created = JSON.parse(fs.readFileSync(SITES_FILE, "utf8")) as TestSite[];
  for (let i = 0; i < created.length; i += 200) {
    const ids = created.slice(i, i + 200).map((s) => s.id);
    await db.delete(sites).where(inArray(sites.id, ids));
  }
  fs.unlinkSync(SITES_FILE);
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  console.log(`deleted ${created.length} test sites`);
  process.exit(0);
}

type Sample = { eventId: string; siteId: string; sessionId: string; sentAt: number };

function makeEvents(site: TestSite, count: number, salt: number) {
  const paths = ["/", "/pricing", "/docs", "/blog", "/contact"];
  return Array.from({ length: count }, (_, i) => {
    const n = salt * 31 + i;
    const path = paths[n % paths.length]!;
    const sessionId = `sess_${site.id.slice(0, 8)}_${n}`;
    return {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      type: "pageview",
      occurredAt: new Date().toISOString(),
      siteKey: site.key,
      sessionId,
      visitorPseudonym: `vis_${n}`,
      url: `https://${site.domain}${path}`,
      path,
      title: `Load test ${path}`,
      referrer: n % 3 === 0 ? "https://google.com/search" : undefined,
      properties: { eventName: "cta_clicked", plan: "growth" },
    };
  });
}

type StageResult = {
  name: string;
  requests: number;
  concurrency: number;
  startedAt: number;
  durationMs: number;
  throughputRps: number;
  eventsSent: number;
  latencies: ReturnType<typeof summarize>;
  statuses: Record<string, number>;
  failures: Record<string, { count: number; example: unknown }>;
};

async function loadStage(options: {
  name: string;
  requests: number;
  concurrency: number;
  sitePool: TestSite[];
  ipFor: (index: number) => string;
  restartIndexOffset: number;
  sample: Sample[];
  sampleEvery: number;
  maxSamples: number;
  eventsPerRequest?: (index: number) => number;
}): Promise<StageResult> {
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  const failures: Record<string, { count: number; example: unknown }> = {};
  let eventsSent = 0;
  let next = 0;
  const startedAt = Date.now();

  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (true) {
        const i = next++;
        if (i >= options.requests) return;
        const site = options.sitePool[i % options.sitePool.length]!;
        const count = options.eventsPerRequest ? options.eventsPerRequest(i) : 1 + (i % 5);
        const events = makeEvents(site, count, options.restartIndexOffset + i);
        const t0 = performance.now();
        let status = 0;
        let body: unknown;
        try {
          const res = await fetch(INGEST_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": UA,
              "X-Forwarded-For": options.ipFor(i),
            },
            body: JSON.stringify({ events }),
          });
          status = res.status;
          body = await res.json().catch(() => undefined);
        } catch (error) {
          status = -1;
          body = (error as Error).message;
        }
        const ms = performance.now() - t0;
        latencies.push(ms);
        statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;
        if (status === 202) {
          eventsSent += count;
          if (i % options.sampleEvery === 0 && options.sample.length < options.maxSamples) {
            options.sample.push({ eventId: events[0]!.eventId, siteId: site.id, sessionId: events[0]!.sessionId, sentAt: Date.now() });
          }
        } else {
          const key = String(status);
          failures[key] ??= { count: 0, example: body };
          failures[key]!.count += 1;
        }
      }
    })
  );

  const durationMs = Date.now() - startedAt;
  return {
    name: options.name,
    requests: options.requests,
    concurrency: options.concurrency,
    startedAt,
    durationMs,
    throughputRps: Number((options.requests / (durationMs / 1000)).toFixed(1)),
    eventsSent,
    latencies: summarize(latencies),
    statuses,
    failures,
  };
}

async function pollDelivery(samples: Sample[], timeoutMs: number) {
  const ch = getClickHouseClient();
  const redis = new Redis(env.REDIS_STATE_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  const pending = new Map(samples.map((s) => [s.eventId, s]));
  const chFirstSeen = new Map<string, number>();
  const redisFirstSeen = new Map<string, number>();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && (pending.size > 0 || redisFirstSeen.size < samples.length)) {
    const ids = [...pending.keys()].slice(0, 1000);
    if (ids.length > 0) {
      try {
        const result = await ch.query({
          query: "SELECT event_id FROM events_raw WHERE event_id IN {ids:Array(UUID)}",
          query_params: { ids },
          format: "JSONEachRow",
        });
        const found = (await result.json()) as { event_id: string }[];
        const now = Date.now();
        for (const { event_id } of found) {
          pending.delete(event_id);
          chFirstSeen.set(event_id, now);
        }
      } catch (error) {
        console.error("clickhouse poll failed:", (error as Error).message);
      }
    }

    const keys = samples.map((s) => `active:${s.siteId}:${s.sessionId}`);
    try {
      const values = await redis.mget(...keys);
      const now = Date.now();
      values.forEach((value, i) => {
        if (value !== null && !redisFirstSeen.has(samples[i]!.eventId)) {
          redisFirstSeen.set(samples[i]!.eventId, now);
        }
      });
    } catch (error) {
      console.error("redis poll failed:", (error as Error).message);
    }

    if (pending.size === 0 && redisFirstSeen.size >= samples.length) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  redis.disconnect();

  const chLatency = samples.filter((s) => chFirstSeen.has(s.eventId)).map((s) => chFirstSeen.get(s.eventId)! - s.sentAt);
  const rtLatency = samples.filter((s) => redisFirstSeen.has(s.eventId)).map((s) => redisFirstSeen.get(s.eventId)! - s.sentAt);
  return {
    sampled: samples.length,
    clickhouse: { found: chFirstSeen.size, missing: pending.size, latencyMs: summarize(chLatency) },
    realtimeRedis: { found: redisFirstSeen.size, latencyMs: summarize(rtLatency) },
  };
}

async function run(siteCount: number) {
  if (!fs.existsSync(SITES_FILE)) {
    throw new Error("run setup first");
  }
  const sitesList = JSON.parse(fs.readFileSync(SITES_FILE, "utf8")) as TestSite[];
  const sitePool = sitesList.slice(0, siteCount);
  const ips = Array.from({ length: 253 }, (_, i) => `203.0.113.${i + 1}`);
  const ipFor = (i: number) => ips[i % ips.length]!;
  const samples: Sample[] = [];
  const sampleEvery = 20;

  const [edgeBefore] = await Promise.all([scrape("http://localhost:3001/metrics")]);
  const workerBefore = await scrape("http://localhost:9464/metrics");
  const kafkaBefore = await kafkaState();

  // Dependency latency sampler, so we can see which backing service degrades first.
  const probes: Record<"postgres" | "redis" | "clickhouse", { ms: number[]; errors: number }> = {
    postgres: { ms: [], errors: 0 },
    redis: { ms: [], errors: 0 },
    clickhouse: { ms: [], errors: 0 },
  };
  const probeRedis = new Redis(env.REDIS_STATE_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await probeRedis.connect();
  const ch = getClickHouseClient();
  let probing = true;
  const probeLoop = (async () => {
    while (probing) {
      const jobs: [keyof typeof probes, () => Promise<unknown>][] = [
        ["postgres", () => db.execute(sql`select 1`)],
        ["redis", () => probeRedis.ping()],
        ["clickhouse", async () => {
          const r = await ch.query({ query: "SELECT 1", format: "JSONEachRow" });
          return r.json();
        }],
      ];
      await Promise.all(
        jobs.map(async ([key, fn]) => {
          const t0 = performance.now();
          try {
            await fn();
            probes[key].ms.push(performance.now() - t0);
          } catch {
            probes[key].errors += 1;
          }
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();

  const stages: StageResult[] = [];
  const coldSites = sitePool;
  stages.push(
    await loadStage({
      name: "cold-site (first request per site)",
      requests: coldSites.length,
      concurrency: 20,
      sitePool: coldSites,
      ipFor,
      restartIndexOffset: 100000,
      sample: samples,
      sampleEvery,
      maxSamples: 400,
      eventsPerRequest: () => 1,
    })
  );
  stages.push(
    await loadStage({
      name: "warm 50 concurrent",
      requests: Math.max(1000, sitePool.length * 3),
      concurrency: 50,
      sitePool,
      ipFor,
      restartIndexOffset: 200000,
      sample: samples,
      sampleEvery,
      maxSamples: 400,
    })
  );
  stages.push(
    await loadStage({
      name: "ramp 150 concurrent",
      requests: Math.max(3000, sitePool.length * 6),
      concurrency: 150,
      sitePool,
      ipFor,
      restartIndexOffset: 300000,
      sample: samples,
      sampleEvery,
      maxSamples: 400,
    })
  );
  stages.push(
    await loadStage({
      name: "ramp 300 concurrent",
      requests: Math.max(6000, sitePool.length * 10),
      concurrency: 300,
      sitePool,
      ipFor,
      restartIndexOffset: 400000,
      sample: samples,
      sampleEvery,
      maxSamples: 400,
    })
  );

  // Rate-limit behaviour: one fresh IP, 1200 requests inside the 60s window.
  const limitIp = "192.0.2.250";
  stages.push(
    await loadStage({
      name: "per-IP limit (1200 req, one IP)",
      requests: 1200,
      concurrency: 50,
      sitePool: [sitePool[0]!],
      ipFor: () => limitIp,
      restartIndexOffset: 500000,
      sample: samples,
      sampleEvery: 100000,
      maxSamples: 0,
      eventsPerRequest: () => 1,
    })
  );

  const delivery = await pollDelivery(samples.filter((_, i) => i % 4 === 0).slice(0, 400), 120_000);

  probing = false;
  await probeLoop;
  probeRedis.disconnect();

  const workerAfter = await scrape("http://localhost:9464/metrics");
  const kafkaAfter = await kafkaState();
  const edgeAfter = await scrape("http://localhost:3001/metrics");

  const delta = (a: number, b: number) => Number((b - a).toFixed(3));
  const insertCount = delta(workerBefore.values.worker_insert_count ?? 0, workerAfter.values.worker_insert_count ?? 0);
  const insertSum = delta(workerBefore.values.worker_insert_sum ?? 0, workerAfter.values.worker_insert_sum ?? 0);
  const publishCount = delta(edgeBefore.values.edge_publish_count ?? 0, edgeAfter.values.edge_publish_count ?? 0);
  const publishSum = delta(edgeBefore.values.edge_publish_sum ?? 0, edgeAfter.values.edge_publish_sum ?? 0);

  const report = {
    target: INGEST_URL,
    sites: sitePool.length,
    generatedAt: new Date().toISOString(),
    stages,
    dependencyProbes: {
      postgres: { ...summarize(probes.postgres.ms), errors: probes.postgres.errors },
      redis: { ...summarize(probes.redis.ms), errors: probes.redis.errors },
      clickhouse: { ...summarize(probes.clickhouse.ms), errors: probes.clickhouse.errors },
    },
    edge: {
      acceptedEvents: delta(edgeBefore.values.edge_accepted ?? 0, edgeAfter.values.edge_accepted ?? 0),
      rejectedEvents: delta(edgeBefore.values.edge_rejected ?? 0, edgeAfter.values.edge_rejected ?? 0),
      redisErrors: delta(edgeBefore.values.edge_redis_errors ?? 0, edgeAfter.values.edge_redis_errors ?? 0),
      kafkaPublishErrors: delta(edgeBefore.values.edge_publish_errors ?? 0, edgeAfter.values.edge_publish_errors ?? 0),
      kafkaPublishBatches: publishCount,
      kafkaPublishAvgMs: publishCount > 0 ? Number(((publishSum / publishCount) * 1000).toFixed(1)) : null,
      siteCache: {
        hit: delta(edgeBefore.values.site_cache_hit ?? 0, edgeAfter.values.site_cache_hit ?? 0),
        miss: delta(edgeBefore.values.site_cache_miss ?? 0, edgeAfter.values.site_cache_miss ?? 0),
      },
    },
    worker: {
      storedEvents: delta(workerBefore.values.worker_stored ?? 0, workerAfter.values.worker_stored ?? 0),
      insertBatches: insertCount,
      insertAvgMs: insertCount > 0 ? Number(((insertSum / insertCount) * 1000).toFixed(1)) : null,
      batchAvgRows: (() => {
        const count = delta(workerBefore.values.worker_batch_count ?? 0, workerAfter.values.worker_batch_count ?? 0);
        const sum = delta(workerBefore.values.worker_batch_sum ?? 0, workerAfter.values.worker_batch_sum ?? 0);
        return count > 0 ? Number((sum / count).toFixed(1)) : null;
      })(),
      dlq: delta(workerBefore.values.worker_dlq ?? 0, workerAfter.values.worker_dlq ?? 0),
      realtimeErrors: delta(workerBefore.values.worker_realtime_errors ?? 0, workerAfter.values.worker_realtime_errors ?? 0),
      v2WriteErrors: delta(workerBefore.values.worker_v2_errors ?? 0, workerAfter.values.worker_v2_errors ?? 0),
      lagBefore: kafkaBefore.partitions,
      lagAfter: kafkaAfter.partitions,
    },
    delivery,
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ---- baseline: open-loop, Zipf sites, mixed events -------------------------------------------

const PATHS = ["/", "/pricing", "/docs", "/blog", "/contact"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const ms = (s?: number) => (s === undefined ? null : Number((s * 1000).toFixed(2)));

/** Sampler for ranks 0..n-1 with P(k) proportional to 1/(k+1)^s (binary search over the CDF). */
function zipf(n: number, s: number): () => number {
  const cdf = new Float64Array(n);
  let total = 0;
  for (let k = 0; k < n; k++) cdf[k] = total += (k + 1) ** -s;
  return () => {
    const u = Math.random() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid]! < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

/** 50% single events, else 2-24 (mean about 4); 70% pageview, 20% web_vital, 10% custom. */
function mixedBatch(site: TestSite) {
  const r = Math.random();
  const n = r < 0.5 ? 1 : r < 0.8 ? 2 + Math.floor(Math.random() * 3) : 5 + Math.floor(Math.random() * 20);
  return Array.from({ length: n }, () => {
    const t = Math.random();
    const path = PATHS[Math.floor(Math.random() * PATHS.length)]!;
    const sessionId = `s${site.id.slice(0, 8)}_${Math.floor(Math.random() * 2000)}`;
    const kind =
      t < 0.7
        ? { type: "pageview" }
        : t < 0.9
          ? { type: "web_vital", webVital: { name: "LCP", value: 1800, rating: "good" } }
          : { type: "custom", properties: { eventName: "cta_clicked" } };
    return {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      siteKey: site.key,
      sessionId,
      visitorPseudonym: `v${sessionId.slice(1)}`,
      url: `https://${site.domain}${path}`,
      path,
      title: path,
      ...kind,
    };
  });
}

/**
 * Poisson arrivals at `rps`, independent of how fast the server answers. A closed loop (fixed
 * workers) slows down when the server stalls and so hides the stall; here latency is measured from
 * the *intended* send time, which counts the time a request would have waited. `lateness` is how
 * far the generator itself lagged: if it is large the run measured the generator, not the edge.
 */
async function openLoop(o: { rps: number; seconds: number; pool: TestSite[]; pick: () => number }) {
  const MAX_INFLIGHT = 5000;
  const latency: number[] = [];
  const lateness: number[] = [];
  const outcomes: Record<string, number> = {};
  const acked = new Map<string, number>();
  const total = Math.round(o.rps * o.seconds);
  const t0 = performance.now();
  let inflight = 0;
  let requests = 0;
  let shed = 0;
  let next = 0;

  const fire = (due: number) => {
    lateness.push(performance.now() - t0 - due);
    if (inflight >= MAX_INFLIGHT) return void shed++;
    const site = o.pool[o.pick()]!;
    const events = mixedBatch(site);
    const octet = () => (Math.random() * 256) | 0;
    inflight++;
    requests++;
    fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, "X-Forwarded-For": `10.${octet()}.${octet()}.${octet()}` },
      body: JSON.stringify({ events }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { processed?: number; error?: string };
        const key = res.status === 202 ? "202" : `${res.status} ${body.error ?? ""}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
        if (res.status === 202) acked.set(site.id, (acked.get(site.id) ?? 0) + (body.processed ?? events.length));
      })
      .catch(() => void (outcomes.network = (outcomes.network ?? 0) + 1))
      .finally(() => {
        inflight--;
        latency.push(performance.now() - t0 - due);
      });
  };

  for (let sent = 0; sent < total; ) {
    const now = performance.now() - t0;
    for (; sent < total && next <= now; sent++) {
      fire(next);
      next += (-Math.log(1 - Math.random()) / o.rps) * 1000;
    }
    await sleep(1);
  }
  while (inflight > 0) await sleep(50);
  return { requests, shed, outcomes, acked, latency: summarize(latency), lateness: summarize(lateness) };
}

/** Rows ClickHouse holds for the test sites since `since`, per site, plus distinct event ids. */
async function stored(ids: string[], since: number, table: string) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error(`bad table ${table}`);
  const r = await getClickHouseClient().query({
    query: `SELECT site_id, count() AS n, uniqExact(event_id) AS u FROM ${table}
            WHERE site_id IN {ids:Array(UUID)} AND timestamp >= {since:DateTime64(3)} GROUP BY site_id`,
    query_params: { ids, since: new Date(since).toISOString().replace("T", " ").replace("Z", "") },
    format: "JSONEachRow",
  });
  const rows = await r.json<{ site_id: string; n: string; u: string }>();
  return { perSite: new Map(rows.map((x) => [x.site_id, +x.n])), rows: sum(rows.map((x) => +x.n)), unique: sum(rows.map((x) => +x.u)) };
}

async function baseline(siteCount: number, rps: number, seconds: number, skew: number) {
  if (!fs.existsSync(SITES_FILE)) throw new Error("run setup first");
  const pool = (JSON.parse(fs.readFileSync(SITES_FILE, "utf8")) as TestSite[]).slice(0, siteCount);
  const table = process.env.E2E_TABLE ?? (env.WORKER_WRITE_V2 === "only" ? "events_v2" : "events_raw");
  const urls = ["http://localhost:3001/metrics", "http://localhost:9464/metrics"];
  const queueCap = Number(process.env.EDGE_QUEUE_MAX_EVENTS ?? 10_000);
  const since = Date.now() - 5_000;

  const before = await snapshot(urls);
  const peak = { queue: 0, lag: 0, parts: {} as Record<string, number> };
  const sampler = setInterval(async () => {
    try {
      const [edge, worker] = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text())));
      peak.queue = Math.max(peak.queue, gauge(edge!, "edge_publish_queue_depth"));
      peak.lag = Math.max(peak.lag, gauge(worker!, "worker_consumer_lag_total"));
      for (const [t, c] of Object.entries(await partsMax())) peak.parts[t] = Math.max(peak.parts[t] ?? 0, c);
    } catch {
      /* a missed sample only lowers a peak */
    }
  }, 2000);

  const gen = await openLoop({ rps, seconds, pool, pick: zipf(pool.length, skew) });
  const acked = sum(gen.acked.values());
  const ids = pool.map((p) => p.id);

  // Drain: wait until storage reaches the acked count or stops growing for 3 polls (max 3 min).
  let led = await stored(ids, since, table);
  for (let i = 0, flat = 0; i < 90 && led.rows < acked && flat < 3; i++) {
    await sleep(2000);
    const nextLed = await stored(ids, since, table);
    flat = nextLed.rows === led.rows ? flat + 1 : 0;
    led = nextLed;
  }
  clearInterval(sampler);
  const after = await snapshot(urls);
  const m = compare(before, after, gen.requests, acked);
  const views = await viewCost(before.at);

  const count = (re: RegExp) => sum(Object.entries(gen.outcomes).filter(([k]) => re.test(k)).map(([, v]) => v));
  const stage = (set: Record<string, Record<string, number>>, name: string) => set[`stage="${name}"`]?.p99;
  const gap = acked ? (acked - led.rows) / acked : 0;
  const dup = led.rows ? (led.rows - led.unique) / led.rows : 0;
  const maxParts = Math.max(0, ...Object.values(peak.parts));
  const redis = m.redis[0]!;
  const decode = stage(m.workerStageSeconds, "decode") ?? 0;
  const dlq = stage(m.workerStageSeconds, "dlq") ?? 0;
  const queueFull = count(/queue is full/);
  const verdicts: [string, string, string, boolean][] = [
    ["F1", "Redis script calls per request (design target: <= 1)", String(redis.scriptCallsPerRequest), redis.scriptCallsPerRequest > 1],
    ["F2", "Redis keys created per admitted event", String(redis.keysPerEvent), redis.keysPerEvent > 0.5],
    ["F3", "peak produce queue / capacity; queue-full 429s", `${peak.queue}/${queueCap}; ${queueFull}`, peak.queue >= queueCap / 2 || queueFull > 0],
    ["F4", "requests rejected by rate limits", String(count(/rate limit/i)), count(/rate limit/i) > 0],
    ["F5", "admission 503s", String(count(/^503/)), count(/^503/) > 0],
    ["F6", "ClickHouse new parts/s; max active parts in a partition", `${m.clickhouse.newPartsPerSec}; ${maxParts}`, m.clickhouse.newPartsPerSec > 20 || maxParts >= 200],
    ["F8", "worker decode / dlq p99 per batch (ms)", `${ms(decode)} / ${ms(dlq)}`, decode > 0.25 || dlq > 0.1],
    ["F7", "duplicate rows (target <= 0.01%)", `${(dup * 100).toFixed(3)}%`, dup > 0.0001],
    ["--", "completeness gap, acked vs stored (target <= 0.1%)", `${(gap * 100).toFixed(3)}%`, gap > 0.001],
    ["--", "generator invalid if lateness p99 > 50 ms or shed > 0", `${gen.lateness.p99?.toFixed(1)} ms; ${gen.shed}`, (gen.lateness.p99 ?? 0) > 50 || gen.shed > 0],
  ];

  const report = {
    config: { sites: pool.length, rps, seconds, zipf: skew, table },
    generator: { requests: gen.requests, ackedEvents: acked, outcomes: gen.outcomes, latencyMs: gen.latency, latenessMs: gen.lateness },
    topSites: pool.slice(0, 10).map((p) => ({ site: p.id.slice(0, 8), acked: gen.acked.get(p.id) ?? 0, stored: led.perSite.get(p.id) ?? 0 })),
    peaks: peak,
    ...m,
    viewCost: views,
    verdicts: verdicts.map(([id, what, value, bad]) => ({ id, what, value, reproduced: bad })),
  };
  fs.writeFileSync(path.join(process.cwd(), "scripts/.e2e-baseline.json"), JSON.stringify(report, null, 2));
  console.log(`\nbaseline: ${rps} rps x ${seconds}s, ${pool.length} sites (zipf ${skew}); full report: scripts/.e2e-baseline.json\n`);
  for (const [id, what, value, bad] of verdicts) console.log(`${bad ? "REPRODUCED" : "ok        "}  ${id.padEnd(2)}  ${what}: ${value}`);
  const table2 = (set: Record<string, Record<string, number>>) =>
    Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { n: v.n, p50_ms: ms(v.p50), p99_ms: ms(v.p99) }]));
  console.log("\nedge stages");
  console.table(table2(m.edgeStageSeconds));
  console.log("worker stages");
  console.table(table2(m.workerStageSeconds));
  if (views.length) console.table(views);
  process.exit(0);
}

async function main() {
  const mode = process.argv[2];
  const siteCount = arg("sites", 1000);
  if (mode === "setup") await setup(siteCount);
  else if (mode === "run") await run(siteCount);
  else if (mode === "baseline") await baseline(siteCount, arg("rps", 2000), arg("seconds", 120), arg("zipf", 1.1));
  else if (mode === "teardown") await teardown();
  else {
    console.error("usage: e2e-load.ts setup|run|baseline|teardown [--sites=N --rps=N --seconds=N --zipf=S]");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
