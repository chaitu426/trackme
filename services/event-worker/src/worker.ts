import os from "node:os";
import { Kafka, logLevel, type EachBatchPayload } from "kafkajs";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { EnrichedEvent } from "@trackme/contracts";
import { getClickHouseClient } from "@trackme/analytics";
import { createClickHouseWriter } from "./writers/clickhouse.js";
import { updateRealtimeState } from "./state/redis-realtime.js";
import { sendToDLQ } from "./dlq.js";
import { checkEvent } from "./contract.js";
import { isDataError } from "./errors.js";
import { kafkaConnection } from "./kafka-config.js";
import { registerZstdCodec } from "./zstd-codec.js";
import { writeIsolating } from "./isolate.js";
import {
  batchRows,
  consumerLag,
  deadLettered,
  eventsStored,
  insertDuration,
  lagAfter,
  realtimeErrors,
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

let isRunning = true;

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

  const parsed = batch.messages.map((msg) =>
    parseMessage(msg.value, msg.offset, batch.partition)
  );

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

  // Realtime is non-fatal and independent of the insert, so run it concurrently
  // instead of paying its latency after the insert. A row ClickHouse later
  // refuses may briefly show as active; that is harmless and self-expires.
  const realtimeUpdate: Promise<void> =
    good.length > 0
      ? updateRealtimeState(redis, good).catch((error) => {
          realtimeErrors.inc();
          console.error("⚠️ Failed to update realtime state:", error);
        })
      : Promise.resolve();

  let refused: Awaited<ReturnType<typeof writeIsolating<EnrichedEvent>>>;
  const stopInsertTimer = insertDuration.startTimer();
  try {
    refused = await writeIsolating(good, writeEventsToClickHouse, isDataError);
  } finally {
    stopInsertTimer();
    await realtimeUpdate;
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
  const written = refusedIds.size === 0 ? good : good.filter((e) => !refusedIds.has(e.eventId));

  for (const letter of deadLetters) {
    await sendToDLQ(letter.raw, letter.reason);
    deadLettered.inc({ reason: letter.kind });
  }
  await heartbeat();

  for (const message of batch.messages) {
    resolveOffset(message.offset);
  }

  batchRows.observe(batch.messages.length);
  eventsStored.inc(written.length);
  const lastMessage = batch.messages[batch.messages.length - 1];
  if (lastMessage) {
    consumerLag.set({ partition: String(batch.partition) }, lagAfter(batch.highWatermark, lastMessage.offset));
  }

  console.log(
    `✅ Kafka partition=${batch.partition} stored=${written.length} dead_lettered=${deadLetters.length}`
  );
}

async function main(): Promise<void> {
  console.log(
    `👷 Event Worker started. Kafka brokers=${env.KAFKA_BROKERS} topic=${TOPIC} group=${GROUP_ID} as ${CONSUMER_NAME}`
  );

  startMetricsServer(env.WORKER_METRICS_PORT);
  await consumer.connect();
  // fromBeginning only applies when the group has no committed offset yet. With
  // false, a new or renamed group would silently skip everything already in the
  // topic. Replaying is safe: event_id dedupes in ClickHouse.
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
    partitionsConsumedConcurrently: env.WORKER_PARTITION_CONCURRENCY,
    eachBatchAutoResolve: false,
    eachBatch: processBatch,
  });
}

async function shutdown(): Promise<void> {
  console.log("Shutting down worker...");
  isRunning = false;
  try {
    await consumer.disconnect();
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
