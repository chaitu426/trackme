/**
 * Dependency probe for the end-to-end load test. Reports reachability and
 * round-trip latency for Postgres, Redis, ClickHouse and Kafka, plus the
 * current row counts and consumer offsets.
 */
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { Redis } from "ioredis";
import { Kafka, logLevel } from "kafkajs";
import { db, sql } from "@trackme/db";
import { env } from "@trackme/config";
import { getClickHouseClient } from "@trackme/analytics";

type Result = { ok: boolean; ms: number; detail?: unknown; error?: string };

async function timed(label: string, fn: () => Promise<unknown>): Promise<Result> {
  const started = performance.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Math.round(performance.now() - started), detail };
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - started), error: (error as Error).message };
  }
}

async function main() {
  const results: Record<string, Result> = {};

  results.postgres = await timed("postgres", async () => {
    const rows = await db.execute(sql`select 1 as ok`);
    const counts = await db.execute(sql`
      select
        (select count(*) from sites) as sites,
        (select count(*) from workspaces) as workspaces,
        (select count(*) from sessions) as sessions
    `);
    return { ping: rows, counts: (counts as unknown as { rows?: unknown }).rows ?? counts };
  });

  const redis = new Redis(env.REDIS_STATE_URL, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  results.redis = await timed("redis", async () => {
    await redis.connect();
    const pong = await redis.ping();
    const memory = await redis.info("memory");
    const used = /used_memory_human:([^\r\n]+)/.exec(memory)?.[1];
    return { pong, used_memory: used };
  });
  redis.disconnect();

  const ch = getClickHouseClient();
  results.clickhouse = await timed("clickhouse", async () => {
    const ping = await ch.query({ query: "SELECT 1 AS ok", format: "JSONEachRow" });
    const tables = await ch.query({
      query: `SELECT name FROM system.tables WHERE database = currentDatabase() AND name IN ('events_raw','events_ingest','events_v2') ORDER BY name`,
      format: "JSONEachRow",
    });
    const names = (await tables.json()) as { name: string }[];
    const counts: Record<string, unknown> = {};
    for (const { name } of names) {
      const q = await ch.query({
        query: `SELECT count() AS rows, max(timestamp) AS latest FROM ${name}`,
        format: "JSONEachRow",
      });
      counts[name] = (await q.json())[0];
    }
    return { ping: await ping.json(), counts };
  });

  const kafka = new Kafka({
    clientId: "e2e-probe",
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
    connectionTimeout: 10_000,
    authenticationTimeout: 10_000,
  });
  const admin = kafka.admin();
  results.kafka = await timed("kafka", async () => {
    await admin.connect();
    const cluster = await admin.describeCluster();
    const topics = await admin.listTopics();
    const metadata = await admin.fetchTopicMetadata({ topics: [env.KAFKA_TOPIC] });
    const offsets = await admin.fetchOffsets({ groupId: env.KAFKA_CONSUMER_GROUP, topics: [env.KAFKA_TOPIC] });
    return {
      brokers: cluster.brokers.length,
      topics: topics.filter((t) => t.startsWith(env.KAFKA_TOPIC) || t.includes("dlq")),
      partitions: metadata.topics[0]?.partitions.length ?? 0,
      groupOffsets: offsets,
    };
  });
  await admin.disconnect().catch(() => undefined);

  console.log(JSON.stringify({ node: process.version, results }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error("probe failed:", error);
  process.exit(1);
});
