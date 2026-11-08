import { Kafka, logLevel } from "kafkajs";
import { env } from "@trackme/config";
import { kafkaConnection } from "./kafka-config.js";

let producerPromise: Promise<ReturnType<Kafka["producer"]>> | null = null;

async function getProducer() {
  if (!producerPromise) {
    producerPromise = (async () => {
      const kafka = new Kafka({
        clientId: "event-worker-dlq",
        ...kafkaConnection(env),
        logLevel: logLevel.ERROR,
      });
      const producer = kafka.producer({ allowAutoTopicCreation: true });
      await producer.connect();
      return producer;
    })();
  }
  return producerPromise;
}

/**
 * Publish rejected messages to the dead-letter topic in one request.
 *
 * Throws if the publish fails. The caller has not resolved the offset yet, so
 * the batch is redelivered instead of the message being lost.
 */
export async function sendToDLQ(letters: { raw: string; reason: string }[]): Promise<void> {
  if (letters.length === 0) return;
  const failedAt = new Date().toISOString();
  const producer = await getProducer();
  // One produce request for the whole batch, not one round trip per message.
  await producer.send({
    topic: env.KAFKA_DLQ_TOPIC,
    messages: letters.map((l) => ({ value: JSON.stringify({ payload: l.raw, error: l.reason, failedAt }) })),
  });
}
