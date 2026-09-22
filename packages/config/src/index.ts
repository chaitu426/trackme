import path from "node:path";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  INGESTION_URL: z.string().url().default("http://localhost:3001"),

  // PostgreSQL
  DATABASE_URL: z
    .string()
    .default("postgres://growth_admin:growth_secure_pass@localhost:5432/growth_intelligence"),

  // ClickHouse
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default("clickhouse_dev_secret"),
  CLICKHOUSE_DB: z.string().default("growth_analytics"),

  // Redis (realtime + rate limit + quota — not the event bus)
  REDIS_URL: z.string().default("redis://:redis_dev_secret@localhost:6379"),

  // Auth
  NEXTAUTH_SECRET: z.string().min(16).default("dev-secret-key-must-be-changed-in-prod-min-32-chars"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),

  // Ingestion Edge (Go only)
  INGESTION_PORT: z.coerce.number().default(3001),
  INGESTION_RATE_LIMIT_MAX: z.coerce.number().default(1000),
  INGESTION_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  MAX_EVENT_PAYLOAD_BYTES: z.coerce.number().default(32768),

  // Workers & Kafka
  EVENT_BATCH_SIZE: z.coerce.number().default(500),
  EVENT_FLUSH_INTERVAL_MS: z.coerce.number().default(1000),
  KAFKA_BROKERS: z.string().default("localhost:9092"),
  KAFKA_TOPIC: z.string().default("growth_events"),
  KAFKA_DLQ_TOPIC: z.string().default("growth_events_dlq"),
  KAFKA_CONSUMER_GROUP: z.string().default("event_worker_group"),
  /** @deprecated Use KAFKA_TOPIC. Kept so old .env files still parse. */
  QUEUE_NAME: z.string().default("growth_events"),

  // Geolocation & Privacy
  DERIVE_GEO_AT_EDGE: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),
  STORE_RAW_IP: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
  DEFAULT_RETENTION_MONTHS: z.coerce.number().default(24),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

let parsedEnv: Environment;

try {
  parsedEnv = EnvironmentSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Invalid environment variables configuration:");
    for (const issue of error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
  }
  // Fail fast instead of silently falling back to defaults: every field
  // already has a workable default, so a validation error here means a
  // *provided* value (e.g. NEXTAUTH_SECRET, DATABASE_URL) is malformed.
  // Falling back would silently discard that value and run with known,
  // publicly-visible dev secrets instead.
  throw new Error("Invalid environment variables configuration. See errors above.");
}

export const env = parsedEnv;

