import os from "node:os";
import { Kafka, logLevel, type EachBatchPayload } from "kafkajs";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { EnrichedEvent } from "@trackme/contracts";
import { getClickHouseClient } from "@trackme/analytics";
import { createClickHouseWriter } from "./writers/clickhouse.js";
import { updateRealtimeState } from "./state/redis-realtime.js";
import { prepareErrorEvents } from "./errors/prepare.js";
import { createErrorWriter } from "./errors/writer.js";
import { sendToDLQ } from "./dlq.js";
import { clearIntent, pin, readIntent, writeIntent } from "./intent.js";
import { checkEvent } from "./contract.js";
import { isDataError } from "./errors.js";
import { kafkaConnection } from "./kafka-config.js";
import { registerZstdCodec } from "./zstd-codec.js";
import { writeIsolating } from "./isolate.js";
import {
  batchRows,
  consumerLag,
  consumerLagTotal,
  deadLettered,
  e2eLatency,
  eventsStored,
  insertDuration,
  intentErrors,
  lagAfter,
  stopwatch,
  realtimeErrors,
  errorWriteFailures,
  errorSamplerFailures,
  v2WriteErrors,
  startMetricsServer,
  type DeadLetterReason,
} from "./metrics.js";

const redis = new Redis(env.REDIS_STATE_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
});

const writeEventsToClickHouse = createClickHouseWriter({
  client: getClickHouseClient(),
  asyncInsert: env.CLICKHOUSE_ASYNC_INSERT,
  flushIntervalMs: env.EVENT_FLUSH_INTERVAL_MS,
  writeMode: env.WORKER_WRITE_V2,
  onV2Error: (error) => {
    v2WriteErrors.inc();
    console.error("⚠️ Shadow write to events_ingest failed:", error);
  },
});

const writeErrors = createErrorWriter({
  client: getClickHouseClient(),
  redis,
  onSamplerError: (error) => {
    errorSamplerFailures.inc();
    console.error("⚠️ Error sampler unavailable; storing counts without detail:", error);
  },
});

const TOPIC = env.KAFKA_TOPIC;
const GROUP_ID = env.KAFKA_CONSUMER_GROUP;
const CONSUMER_NAME = `${os.hostname()}-${process.pid}`;

registerZstdCodec();

const kafka = new Kafka({
  clientId: `event-worker-${CONSUMER_NAME}`,
  ...kafkaConnection(env),
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

const consumer = kafka.consumer({
  groupId: GROUP_ID,
  sessionTimeout: 30_000,
  heartbeatInterval: 3_000,
  // Large, infrequent inserts: wait for ~1 MB but never longer than maxWaitTimeInMs.
  minBytes: env.WORKER_FETCH_MIN_BYTES,
  maxWaitTimeInMs: env.WORKER_FETCH_MAX_WAIT_MS,
  maxBytesPerPartition: env.WORKER_FETCH_MAX_BYTES_PER_PARTITION,
});

// Freshness for the live view comes from this consumer; the writer above can afford big blocks.
const realtimeConsumer = kafka.consumer({
  groupId: `${GROUP_ID}_realtime`,
  sessionTimeout: 30_000,
  heartbeatInterval: 3_000,
  minBytes: 1,
  maxWaitTimeInMs: 100,
});

/** WORKER_ROLES=writer,realtime runs both in one process; split them across deployments to scale separately. */
const roles = new Set(env.WORKER_ROLES.split(",").map((r) => r.trim()));

const admin = kafka.admin();

let isRunning = true;
let lagTimer: NodeJS.Timeout | null = null;

type ParsedMessage = {
  offset: string;
  partition: number;
  decoded: unknown;
  raw: string;
};

function parseMessage(value: Buffer | null, offset: string, partition: number): ParsedMessage {
  const raw = value ? value.toString("utf8") : "";
  try {
    return { offset, partition, decoded: raw ? JSON.parse(raw) : null, raw };
  } catch {
    return { offset, partition, decoded: null, raw };
  }
}

/**
 * Sample lag from the admin API on a timer. The per-batch gauge only updates
 * after a batch completes, so it keeps its old value (often 0) while the
 * consumer is stalled; this sampler stays truthful either way.
 */
async function sampleConsumerLag(): Promise<void> {
  try {
    const [topicOffsets, groupOffsets] = await Promise.all([
      admin.fetchTopicOffsets(TOPIC),
      admin.fetchOffsets({ groupId: GROUP_ID, topics: [TOPIC] }),
    ]);
    const committed = new Map<number, bigint>();
    for (const topic of groupOffsets) {
      if (topic.topic !== TOPIC) continue;
      for (const partition of topic.partitions) {
        if (partition.offset !== "-1") committed.set(partition.partition, BigInt(partition.offset));
      }
    }
    let total = 0n;
    for (const partition of topicOffsets) {
      const high = BigInt(partition.high);
      const current = committed.get(partition.partition) ?? BigInt(partition.low);
      const lag = high > current ? high - current : 0n;
      consumerLag.set({ partition: String(partition.partition) }, Number(lag));
      total += lag;
    }
    consumerLagTotal.set(Number(total));
  } catch (error) {
    console.error("⚠️ Failed to sample consumer lag:", error);
  }
}

/**
 * Process a Kafka batch.
 *
 * Order of operations is the delivery guarantee:
 *   1. classify every message; undecodable or contract-violating ones are set aside
 *   2. write the good ones to ClickHouse, isolating any row ClickHouse refuses
 *   3. dead-letter everything set aside
 *   4. only then resolve offsets, in order
 *
 * A failure at step 2 (ClickHouse down) or step 3 (DLQ down) throws before any
 * offset is resolved, so Kafka redelivers the batch. event_id + ReplacingMergeTree
 * collapses the duplicates a redelivery creates. Offsets are resolved together at
 * the end because kafkajs treats resolving offset N as "everything up to N is done".
 */
async function processBatch({
  batch,
  resolveOffset,
  heartbeat,
  isRunning: batchRunning,
}: EachBatchPayload): Promise<void> {
  if (!batchRunning() || !isRunning) return;
  const lap = stopwatch();
  const { partition } = batch;

  // Exact replay (see intent.ts): after a crash, re-cut this batch to the range that was
  // being inserted so the dedupe token matches. Redis trouble degrades exactness, not liveness.
  const intent = await readIntent(redis, GROUP_ID, partition).catch(() => (intentErrors.inc(), null));
  const messages = pin(batch.messages, intent);
  if (messages.length === 0) return;
  const range = { first: messages[0]!.offset, last: messages[messages.length - 1]!.offset };
  if (intent?.first !== range.first || intent.last !== range.last) {
    await writeIntent(redis, GROUP_ID, partition, range).catch(() => intentErrors.inc());
  }

  const parsed = messages.map((msg) => parseMessage(msg.value, msg.offset, partition));

  const good: EnrichedEvent[] = [];
  const deadLetters: { raw: string; reason: string; kind: DeadLetterReason }[] = [];

  for (const entry of parsed) {
    if (entry.decoded === null) {
      deadLetters.push({ raw: entry.raw, reason: "Malformed event payload", kind: "malformed" });
      continue;
    }
    const verdict = checkEvent(entry.decoded);
    if (verdict.ok) {
      good.push(verdict.event);
    } else {
      deadLetters.push({ raw: entry.raw, reason: verdict.reason, kind: "contract" });
    }
  }
  await heartbeat();
  lap("decode");

  // Error events are scrubbed and grouped first, so the normal insert already carries their group id.
  const prepared = prepareErrorEvents(good);

  let refused: Awaited<ReturnType<typeof writeIsolating<EnrichedEvent>>>;
  const stopInsertTimer = insertDuration.startTimer();
  try {
    refused = await writeIsolating(prepared.events, writeEventsToClickHouse, isDataError);
  } finally {
    stopInsertTimer();
    lap("insert");
  }
  const refusedIds = new Set<string>();
  for (const { item, error } of refused) {
    refusedIds.add(item.eventId);
    deadLetters.push({
      raw: JSON.stringify(item),
      reason: `clickhouse rejected row: ${error instanceof Error ? error.message : String(error)}`,
      kind: "clickhouse_rejected",
    });
  }
  const written = refusedIds.size === 0 ? prepared.events : prepared.events.filter((e) => !refusedIds.has(e.eventId));

  // Error-tracking rows are secondary to the events, which are already stored. A failure here is counted and
  // logged rather than replaying the whole batch, which would write every event in it twice.
  try {
    await writeErrors(prepared);
  } catch (error) {
    errorWriteFailures.inc();
    console.error("⚠️ Failed to store error-tracking rows:", error);
  }

  // Edge receipt -> insert completion. receivedAt is stamped before admission,
  // so this measures the full ingestion pipeline, not just the ClickHouse call.
  const insertedAt = Date.now();
  for (const event of written) {
    const receivedAt = Date.parse(event.receivedAt);
    if (!Number.isNaN(receivedAt)) {
      e2eLatency.observe(Math.max(0, insertedAt - receivedAt) / 1000);
    }
  }

  await sendToDLQ(deadLetters);
  for (const letter of deadLetters) deadLettered.inc({ reason: letter.kind });
  await heartbeat();
  lap("dlq");

  for (const message of messages) resolveOffset(message.offset);
  // Commit after every batch (not on a timer) so the only range that can ever be replayed is
  // the one in the intent record. The record is cleared after the commit; a crash between the
  // two leaves a stale record that pin() ignores because the next batch starts past it.
  await consumer.commitOffsets([{ topic: TOPIC, partition, offset: (BigInt(range.last) + 1n).toString() }]);
  await clearIntent(redis, GROUP_ID, partition).catch(() => intentErrors.inc());

  batchRows.observe(messages.length);
  eventsStored.inc(written.length);
  consumerLag.set({ partition: String(partition) }, lagAfter(batch.highWatermark, range.last));

  console.log(`✅ Kafka partition=${partition} stored=${written.length} dead_lettered=${deadLetters.length}`);
}

/**
 * Realtime has its own consumer group, so a slow or failing Redis can never delay an insert,
 * and inserts never delay the live view. It reads only new messages (a fresh group starts at
 * the end: five minutes of history is all realtime shows) and is idempotent, so the default
 * auto-commit and at-least-once delivery are fine. Malformed messages are the writer's to dead-letter.
 */
async function processRealtime({ batch }: EachBatchPayload): Promise<void> {
  const events: EnrichedEvent[] = [];
  for (const m of batch.messages) {
    try {
      if (m.value) events.push(JSON.parse(m.value.toString("utf8")) as EnrichedEvent);
    } catch {
      /* dead-lettered by the writer group */
    }
  }
  if (events.length === 0) return;
  await updateRealtimeState(redis, events).catch((error) => {
    realtimeErrors.inc();
    console.error("⚠️ Failed to update realtime state:", error);
  });
}

async function main(): Promise<void> {
  console.log(
    `👷 Event Worker started. Kafka brokers=${env.KAFKA_BROKERS} topic=${TOPIC} group=${GROUP_ID} as ${CONSUMER_NAME}`
  );

  startMetricsServer(env.WORKER_METRICS_PORT);
  if (roles.has("writer")) {
    await consumer.connect();
    await admin.connect();
    // fromBeginning only applies when the group has no committed offset yet. With
    // false, a new or renamed group would silently skip everything already in the
    // topic. Replaying is safe: event_id dedupes in ClickHouse.
    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
    await consumer.run({
      autoCommit: false, // committed explicitly after each batch, see processBatch
      partitionsConsumedConcurrently: env.WORKER_PARTITION_CONCURRENCY,
      eachBatchAutoResolve: false,
      eachBatch: processBatch,
    });
    void sampleConsumerLag();
    lagTimer = setInterval(() => void sampleConsumerLag(), env.WORKER_LAG_SAMPLE_MS);
    lagTimer.unref();
  }
  if (roles.has("realtime")) {
    await realtimeConsumer.connect();
    await realtimeConsumer.subscribe({ topic: TOPIC, fromBeginning: false });
    await realtimeConsumer.run({ eachBatch: processRealtime });
  }
}

async function shutdown(): Promise<void> {
  console.log("Shutting down worker...");
  isRunning = false;
  if (lagTimer) {
    clearInterval(lagTimer);
    lagTimer = null;
  }
  for (const c of [consumer, realtimeConsumer]) {
    try {
      await c.disconnect();
    } catch {
      // ignore
    }
  }
  try {
    await admin.disconnect();
  } catch {
    // ignore
  }
  redis.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

main().catch((error) => {
  console.error("❌ Worker failed to start:", error);
  process.exit(1);
});
