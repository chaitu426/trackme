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

export async function sendToDLQ(failedPayload: string, errorMessage: string): Promise<void> {
  try {
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
  } catch (err) {
    console.error("Critical: Failed to publish to Kafka DLQ", err);
  }
}
