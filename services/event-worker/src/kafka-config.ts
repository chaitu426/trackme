import fs from "node:fs";
import type { KafkaConfig, SASLOptions } from "kafkajs";

export interface KafkaConnectionEnv {
  KAFKA_BROKERS: string;
  KAFKA_SSL: boolean;
  KAFKA_SASL_MECHANISM?: "plain" | "scram-sha-256" | "scram-sha-512" | undefined;
  KAFKA_SASL_USERNAME?: string | undefined;
  KAFKA_SASL_PASSWORD?: string | undefined;
  KAFKA_CA_CERT_PATH?: string | undefined;
}

/**
 * Connection options shared by every kafkajs client: brokers plus TLS/SASL for
 * managed clusters. With nothing set it returns the plaintext local config, so the
 * Docker setup is unchanged.
 */
export function kafkaConnection(
  source: KafkaConnectionEnv,
  readFile: (path: string) => string = (p) => fs.readFileSync(p, "utf8")
): Pick<KafkaConfig, "brokers" | "ssl" | "sasl"> {
  const brokers = source.KAFKA_BROKERS.split(",").map((b) => b.trim()).filter(Boolean);

  let sasl: SASLOptions | undefined;
  if (source.KAFKA_SASL_MECHANISM) {
    if (!source.KAFKA_SASL_USERNAME || !source.KAFKA_SASL_PASSWORD) {
      throw new Error("KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required when KAFKA_SASL_MECHANISM is set");
    }
    sasl = {
      mechanism: source.KAFKA_SASL_MECHANISM,
      username: source.KAFKA_SASL_USERNAME,
      password: source.KAFKA_SASL_PASSWORD,
    } as SASLOptions;
  }

  // SASL credentials must never cross the network in clear text.
  if (sasl && !source.KAFKA_SSL) {
    throw new Error("KAFKA_SASL_MECHANISM requires KAFKA_SSL=true");
  }

  const ssl = source.KAFKA_SSL
    ? source.KAFKA_CA_CERT_PATH
      ? { ca: [readFile(source.KAFKA_CA_CERT_PATH)] }
      : true
    : undefined;

  return { brokers, ...(ssl ? { ssl } : {}), ...(sasl ? { sasl } : {}) };
}
