import { Kafka, logLevel } from "kafkajs";
import { env } from "@trackme/config";

let producerPromise: Promise<ReturnType<Kafka["producer"]>> | null = null;

async function getProducer() {
  if (!producerPromise) {
    producerPromise = (async () => {
      const kafka = new Kafka({
        clientId: "event-worker-dlq",
        brokers: env.KAFKA_BROKERS.split(",").map((b) => b.trim()).filter(Boolean),
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
 * Publish a rejected message to the dead-letter topic.
 *
 * Throws if the publish fails. The caller has not resolved the offset yet, so
 * the batch is redelivered instead of the message being lost.
 */
export async function sendToDLQ(failedPayload: string, errorMessage: string): Promise<void> {
  const producer = await getProducer();
  await producer.send({
    topic: env.KAFKA_DLQ_TOPIC,
    messages: [
      {
        value: JSON.stringify({
          payload: failedPayload,
          error: errorMessage,
          failedAt: new Date().toISOString(),
        }),
      },
    ],
  });
}
