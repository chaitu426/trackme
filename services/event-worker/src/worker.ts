import os from "node:os";
import { Kafka, logLevel, type EachBatchPayload } from "kafkajs";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { EnrichedEvent } from "@trackme/contracts";
import { writeEventsToClickHouse } from "./writers/clickhouse.js";
import { updateRealtimeState } from "./state/redis-realtime.js";
import { sendToDLQ } from "./dlq.js";

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
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
  event: EnrichedEvent | null;
  raw: string;
};

function parseMessage(value: Buffer | null, offset: string, partition: number): ParsedMessage {
  const raw = value ? value.toString("utf8") : "";
  try {
    return {
      offset,
      partition,
      event: raw ? (JSON.parse(raw) as EnrichedEvent) : null,
      raw,
    };
  } catch {
    return { offset, partition, event: null, raw };
  }
}

/**
 * Process a Kafka batch: write ClickHouse first, only then resolve offsets.
 * Failed CH writes leave offsets uncommitted for redelivery (at-least-once).
 * event_id + ReplacingMergeTree collapses duplicates into exactly-once reads.
 */
async function processBatch({
  batch,
  resolveOffset,
  heartbeat,
  isRunning: batchRunning,
}: EachBatchPayload): Promise<void> {
  const parsed = batch.messages.map((msg) =>
    parseMessage(msg.value, msg.offset, batch.partition)
  );

  const valid: EnrichedEvent[] = [];
  const validOffsets: string[] = [];

  for (const entry of parsed) {
    if (!batchRunning() || !isRunning) {
      return;
    }
    if (entry.event) {
      valid.push(entry.event);
      validOffsets.push(entry.offset);
    } else {
      await sendToDLQ(entry.raw, "Malformed event payload");
      resolveOffset(entry.offset);
    }
    await heartbeat();
  }

  if (valid.length === 0) {
    return;
  }

  await writeEventsToClickHouse(valid);

  for (const offset of validOffsets) {
    resolveOffset(offset);
  }

  try {
    await updateRealtimeState(redis, valid);
  } catch (error) {
    console.error("⚠️ Failed to update realtime state (events already committed):", error);
  }

  console.log(
    `✅ Kafka partition=${batch.partition} committed ${valid.length} events to ClickHouse.`
  );
}

async function main(): Promise<void> {
  console.log(
    `👷 Event Worker started. Kafka brokers=${env.KAFKA_BROKERS} topic=${TOPIC} group=${GROUP_ID} as ${CONSUMER_NAME}`
  );

  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

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
