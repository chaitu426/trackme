// One-off cleanup for the e2e load test. Probe is read-only; apply deletes only
// records/rows tied to site_pub_e2e_* (plus the throwaway PG sites).
//   pnpm --filter @trackme/event-worker exec tsx clear-test-data.mts probe
//   pnpm --filter @trackme/event-worker exec tsx clear-test-data.mts apply
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { registerZstdCodec } from "./src/zstd-codec.js";

registerZstdCodec();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const envFile = path.join(root, ".env");
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!match) continue;
  const [, key, raw] = match;
  if (process.env[key] === undefined) {
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

const {
  KAFKA_BROKERS,
  KAFKA_TOPIC,
  KAFKA_DLQ_TOPIC,
  KAFKA_SSL,
  KAFKA_CA_CERT_PATH,
  KAFKA_SASL_MECHANISM,
  KAFKA_SASL_USERNAME,
  KAFKA_SASL_PASSWORD,
  KAFKA_CONSUMER_GROUP,
  CLICKHOUSE_URL,
  CLICKHOUSE_USER,
  CLICKHOUSE_PASSWORD,
  CLICKHOUSE_DB,
  DATABASE_URL,
} = process.env;

const TEST_PREFIX = "site_pub_e2e_";
const mode = process.argv[2] ?? "probe";

const kafkaRequire = createRequire(path.join(here, "package.json"));
const { Kafka, logLevel } = kafkaRequire("kafkajs");

function kafkaClient() {
  return new Kafka({
    clientId: "e2e-cleanup",
    brokers: KAFKA_BROKERS.split(",").map((b) => b.trim()).filter(Boolean),
    logLevel: logLevel.ERROR,
    ssl: KAFKA_SSL === "true" ? (KAFKA_CA_CERT_PATH ? { ca: [fs.readFileSync(KAFKA_CA_CERT_PATH, "utf8")] } : true) : undefined,
    sasl: KAFKA_SASL_MECHANISM
      ? {
          mechanism: KAFKA_SASL_MECHANISM,
          username: KAFKA_SASL_USERNAME ?? "",
          password: KAFKA_SASL_PASSWORD ?? "",
        }
      : undefined,
  });
}

async function ch(query) {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set("database", CLICKHOUSE_DB);
  url.searchParams.set("default_format", "JSONEachRow");
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-ClickHouse-User": CLICKHOUSE_USER, "X-ClickHouse-Key": CLICKHOUSE_PASSWORD },
    body: query,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse: ${text.slice(0, 500)}`);
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}

const SITE_KEY_TABLES = ["events_raw", "events_ingest"];
const SITE_ID_TABLES = [
  "events_v2",
  "pageview_rollups_hourly",
  "pageview_rollups_daily",
  "event_rollups_daily",
  "web_vitals",
  "web_vitals_agg",
  "session_engagement_daily",
  "daily_uniques",
  "site_daily_agg",
  "session_day_agg",
  "dim_daily_agg",
  "filter_daily_agg",
  "event_daily_agg",
];

async function clickhouseInventory() {
  try {
    const ids = (
    await ch(`SELECT DISTINCT site_id FROM ${CLICKHOUSE_DB}.events_raw WHERE site_key LIKE '${TEST_PREFIX}%'
      UNION DISTINCT
      SELECT DISTINCT site_id FROM ${CLICKHOUSE_DB}.events_ingest WHERE site_key LIKE '${TEST_PREFIX}%'`)
  ).map((row) => row.site_id);

  const counts = {};
  for (const table of SITE_KEY_TABLES) {
    const keyed = await ch(`SELECT count() AS n FROM ${CLICKHOUSE_DB}.${table} WHERE site_key LIKE '${TEST_PREFIX}%'`);
    const byId = ids.length
      ? await ch(`SELECT count() AS n FROM ${CLICKHOUSE_DB}.${table} WHERE site_id IN (${ids.map((id) => `'${id}'`).join(",")})`)
      : [{ n: "0" }];
    counts[table] = { byKey: Number(keyed[0]?.n ?? 0), byId: Number(byId[0]?.n ?? 0) };
  }
  for (const table of SITE_ID_TABLES) {
    try {
      const row = ids.length
        ? await ch(`SELECT count() AS n FROM ${CLICKHOUSE_DB}.${table} WHERE site_id IN (${ids.map((id) => `'${id}'`).join(",")})`)
        : [{ n: "0" }];
      counts[table] = Number(row[0]?.n ?? 0);
    } catch (error) {
      counts[table] = `error: ${String(error).slice(0, 120)}`;
    }
  }
  return { siteIds: ids.length, ids, counts };
  } catch (error) {
    return { error: String(error).slice(0, 300) };
  }
}

async function kafkaInventory() {
  const admin = kafkaClient().admin();
  await admin.connect();
  try {
    const offsets = await admin.fetchTopicOffsets(KAFKA_TOPIC);
    const committed = await admin.fetchOffsets({ groupId: KAFKA_CONSUMER_GROUP, topics: [KAFKA_TOPIC] });
    const offsetsByPartition = new Map(committed[0]?.partitions.map((p) => [p.partition, p.offset]) ?? []);
    const partitions = offsets.map((p) => ({
      partition: p.partition,
      low: Number(p.low),
      high: Number(p.high),
      committed: Number(offsetsByPartition.get(p.partition) ?? -1),
    }));
    let dlq = "missing";
    try {
      dlq = (await admin.fetchTopicOffsets(KAFKA_DLQ_TOPIC)).map((p) => `${p.partition}:${p.high}`).join(",");
    } catch {
      dlq = "not-found";
    }
    return { partitions, total: partitions.reduce((sum, p) => sum + (p.high - p.low), 0), dlq };
  } finally {
    await admin.disconnect();
  }
}

async function scanKafka(expectedTotal) {
  const consumer = kafkaClient().consumer({ groupId: `e2e-cleanup-scan-${Date.now()}` });
  const counts = { expected: expectedTotal, total: 0, test: 0, other: 0, unparseable: 0 };
  const otherSamples = [];
  let finished;
  const done = new Promise((resolve) => (finished = resolve));
  await consumer.connect();
  await consumer.subscribe({ topics: [KAFKA_TOPIC], fromBeginning: true });
  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset }) => {
      for (const message of batch.messages) {
        counts.total += 1;
        resolveOffset(message.offset);
        try {
          const parsed = JSON.parse(message.value?.toString("utf8") ?? "");
          if (String(parsed.siteKey ?? "").startsWith(TEST_PREFIX)) counts.test += 1;
          else {
            counts.other += 1;
            if (otherSamples.length < 10) otherSamples.push({ partition: batch.partition, siteKey: parsed.siteKey ?? null });
          }
        } catch {
          counts.unparseable += 1;
          if (otherSamples.length < 10) otherSamples.push({ partition: batch.partition, siteKey: "<unparseable>" });
        }
      }
    },
  });
  const idle = setInterval(() => {
    if (counts.total >= expectedTotal) {
      clearInterval(idle);
      finished();
    }
  }, 250);
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 45_000))]);
  clearInterval(idle);
  await consumer.disconnect().catch(() => undefined);
  return { ...counts, otherSamples };
}

async function deleteKafka(highByPartition) {
  const admin = kafkaClient().admin();
  await admin.connect();
  try {
    await admin.fetchTopicMetadata({ topics: [KAFKA_TOPIC] });
    await admin.deleteTopicRecords({
      topic: KAFKA_TOPIC,
      partitions: highByPartition.map((p) => ({ partition: p.partition, offset: p.high })),
    });
  } finally {
    await admin.disconnect();
  }
}

async function deleteClickhouse(siteIds) {
  const idList = siteIds.map((id) => `'${id}'`).join(",");
  const done = {};
  for (const table of SITE_KEY_TABLES) {
    const where = idList
      ? `(site_key LIKE '${TEST_PREFIX}%' OR site_id IN (${idList}))`
      : `site_key LIKE '${TEST_PREFIX}%'`;
    await ch(`ALTER TABLE ${CLICKHOUSE_DB}.${table} DELETE WHERE ${where} SETTINGS mutations_sync = 2`);
    done[table] = "deleted";
  }
  for (const table of SITE_ID_TABLES) {
    if (!idList) {
      done[table] = "no test site ids";
      continue;
    }
    try {
      await ch(`ALTER TABLE ${CLICKHOUSE_DB}.${table} DELETE WHERE site_id IN (${idList}) SETTINGS mutations_sync = 2`);
      done[table] = "deleted";
    } catch (error) {
      done[table] = `error: ${String(error).slice(0, 160)}`;
    }
  }
  return done;
}

async function pgClient() {
  const postgres = createRequire(path.join(root, "packages/db/package.json"))("postgres");
  return postgres(DATABASE_URL, { max: 1 });
}

async function postgresInventory() {
  const sql = await pgClient();
  try {
    const row = await sql`select count(*)::int as n from sites where public_key like ${TEST_PREFIX + "%"}`;
    return row[0]?.n ?? 0;
  } finally {
    await sql.end();
  }
}

async function deletePostgresSites() {
  const sql = await pgClient();
  try {
    const deleted = await sql`delete from sites where public_key like ${TEST_PREFIX + "%"} returning id`;
    return { deleted: deleted.length };
  } finally {
    await sql.end();
  }
}

const kafka = await kafkaInventory();
console.log("KAFKA", JSON.stringify(kafka));
const scan = await scanKafka(kafka.total);
console.log("SCAN", JSON.stringify(scan));
console.log("POSTGRES", JSON.stringify({ testSites: await postgresInventory() }));
const state = await clickhouseInventory();
console.log("CLICKHOUSE", JSON.stringify(state));

if (mode !== "apply") {
  console.log("probe only; rerun with `apply` to delete");
  process.exit(0);
}
if (scan.other > 0 || scan.unparseable > 0) {
  console.error("ABORT: topic contains non-test or unparseable messages:", JSON.stringify(scan.otherSamples));
  process.exit(2);
}
if (scan.total < kafka.total) {
  console.error(`ABORT: scanned ${scan.total} of ${kafka.total} records; refusing to delete an unverified topic`);
  process.exit(2);
}
if (kafka.total > 0) {
  await deleteKafka(kafka.partitions);
  console.log("kafka records deleted up to high watermark");
}
if (state.error) {
  console.log("CLICKHOUSE DELETE skipped:", state.error);
} else {
  console.log("CLICKHOUSE DELETE", JSON.stringify(await deleteClickhouse(state.ids ?? [])));
}
console.log("POSTGRES DELETE", JSON.stringify(await deletePostgresSites()));

const afterScan = await scanKafka(0);
console.log("SCAN AFTER", JSON.stringify(afterScan));
console.log("CLICKHOUSE AFTER", JSON.stringify(await clickhouseInventory()));
process.exit(0);
