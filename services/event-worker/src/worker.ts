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
import { writeIsolating } from "./isolate.js";

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
});

const writeEventsToClickHouse = createClickHouseWriter({
  client: getClickHouseClient(),
  asyncInsert: env.CLICKHOUSE_ASYNC_INSERT,
  flushIntervalMs: env.EVENT_FLUSH_INTERVAL_MS,
});

const TOPIC = env.KAFKA_TOPIC;
const GROUP_ID = env.KAFKA_CONSUMER_GROUP;
const CONSUMER_NAME = `${os.hostname()}-${process.pid}`;

const kafka = new Kafka({
  clientId: `event-worker-${CONSUMER_NAME}`,
  brokers: env.KAFKA_BROKERS.split(",").map((b) => b.trim()).filter(Boolean),
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
  maxBytesPerPartition: 1_048_576,
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
  const deadLetters: { raw: string; reason: string }[] = [];

  for (const entry of parsed) {
    if (entry.decoded === null) {
      deadLetters.push({ raw: entry.raw, reason: "Malformed event payload" });
      continue;
    }
    const verdict = checkEvent(entry.decoded);
    if (verdict.ok) {
      good.push(verdict.event);
    } else {
      deadLetters.push({ raw: entry.raw, reason: verdict.reason });
    }
  }
  await heartbeat();

  const refused = await writeIsolating(good, writeEventsToClickHouse, isDataError);
  const refusedIds = new Set<string>();
  for (const { item, error } of refused) {
    refusedIds.add(item.eventId);
    deadLetters.push({
      raw: JSON.stringify(item),
      reason: `clickhouse rejected row: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const written = refusedIds.size === 0 ? good : good.filter((e) => !refusedIds.has(e.eventId));

  for (const letter of deadLetters) {
    await sendToDLQ(letter.raw, letter.reason);
  }
  await heartbeat();

  for (const message of batch.messages) {
    resolveOffset(message.offset);
  }

  if (written.length > 0) {
    try {
      await updateRealtimeState(redis, written);
    } catch (error) {
      console.error("⚠️ Failed to update realtime state (events already committed):", error);
    }
  }

  console.log(
    `✅ Kafka partition=${batch.partition} stored=${written.length} dead_lettered=${deadLetters.length}`
  );
}

async function main(): Promise<void> {
  console.log(
    `👷 Event Worker started. Kafka brokers=${env.KAFKA_BROKERS} topic=${TOPIC} group=${GROUP_ID} as ${CONSUMER_NAME}`
  );

  await consumer.connect();
  // fromBeginning only applies when the group has no committed offset yet. With
  // false, a new or renamed group would silently skip everything already in the
  // topic. Replaying is safe: event_id dedupes in ClickHouse.
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  await consumer.run({
    autoCommit: true,
    autoCommitInterval: 5000,
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
