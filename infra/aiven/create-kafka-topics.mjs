// Creates the event and dead-letter topics on a managed Kafka (Aiven does not
// auto-create topics). Safe to re-run: existing topics are left alone.
//
//   node infra/aiven/create-kafka-topics.mjs
import fs from "node:fs";
import { loadEnv, need, requireFrom } from "./lib.mjs";

loadEnv();
const { Kafka, logLevel } = requireFrom("services/event-worker", "kafkajs");

const partitions = Number(process.env.KAFKA_PARTITIONS ?? 3);
const replication = Number(process.env.KAFKA_REPLICATION ?? 2);
const ca = process.env.KAFKA_CA_CERT_PATH;

const kafka = new Kafka({
  clientId: "aiven-setup",
  brokers: need("KAFKA_BROKERS").split(",").map((b) => b.trim()),
  logLevel: logLevel.WARN,
  ssl: process.env.KAFKA_SSL === "true" ? (ca ? { ca: [fs.readFileSync(ca, "utf8")] } : true) : undefined,
  sasl: process.env.KAFKA_SASL_MECHANISM
    ? {
        mechanism: process.env.KAFKA_SASL_MECHANISM,
        username: need("KAFKA_SASL_USERNAME"),
        password: need("KAFKA_SASL_PASSWORD"),
      }
    : undefined,
});

const admin = kafka.admin();
await admin.connect();
try {
  const topics = [
    { topic: need("KAFKA_TOPIC"), numPartitions: partitions, replicationFactor: replication },
    { topic: need("KAFKA_DLQ_TOPIC"), numPartitions: 1, replicationFactor: replication },
  ];
  const existing = new Set(await admin.listTopics());
  const missing = topics.filter((t) => !existing.has(t.topic));
  if (missing.length) {
    await admin.createTopics({ topics: missing, waitForLeaders: true });
    console.log("created:", missing.map((t) => t.topic).join(", "));
  }
  console.log("already existed:", topics.filter((t) => existing.has(t.topic)).map((t) => t.topic).join(", ") || "none");
  const meta = await admin.fetchTopicMetadata({ topics: topics.map((t) => t.topic) });
  for (const t of meta.topics) console.log(`  ${t.name}: ${t.partitions.length} partitions`);
} finally {
  await admin.disconnect();
}
