import path from "node:path";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Values the schema falls back to so a fresh checkout runs with no .env. They are
 * public (they live in this repository), so a production process must never use them.
 */
export const DEV_DEFAULTS = {
  DATABASE_URL: "postgres://growth_admin:growth_secure_pass@localhost:5432/growth_intelligence",
  CLICKHOUSE_PASSWORD: "clickhouse_dev_secret",
  REDIS_URL: "redis://:redis_dev_secret@localhost:6379",
  NEXTAUTH_SECRET: "dev-secret-key-must-be-changed-in-prod-min-32-chars",
} as const;

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  INGESTION_URL: z.string().url().default("http://localhost:3001"),

  // PostgreSQL
  DATABASE_URL: z.string().default(DEV_DEFAULTS.DATABASE_URL),

  // ClickHouse
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(DEV_DEFAULTS.CLICKHOUSE_PASSWORD),
  CLICKHOUSE_DB: z.string().default("growth_analytics"),

  // Redis (realtime + rate limit + quota — not the event bus)
  REDIS_URL: z.string().default(DEV_DEFAULTS.REDIS_URL),

  // Auth
  NEXTAUTH_SECRET: z.string().min(16).default(DEV_DEFAULTS.NEXTAUTH_SECRET),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),

  // Ingestion Edge (Go only)
  INGESTION_PORT: z.coerce.number().default(3001),
  INGESTION_RATE_LIMIT_MAX: z.coerce.number().default(1000),
  INGESTION_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  MAX_EVENT_PAYLOAD_BYTES: z.coerce.number().default(32768),

  // Workers & Kafka
  /** How long ClickHouse may hold rows to build larger parts (async_insert_busy_timeout_ms). */
  EVENT_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  /** Let ClickHouse batch small inserts; the worker still waits for the flush. */
  CLICKHOUSE_ASYNC_INSERT: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),
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

  // Rollup jobs (scheduled-worker)
  /** Days before today that every run recomputes, so late events are picked up. */
  ROLLUP_LOOKBACK_DAYS: z.coerce.number().int().min(0).default(2),
  /** How far back a new or lagging rollup table is filled. Covers a 30-day range plus its previous period. */
  ROLLUP_BACKFILL_DAYS: z.coerce.number().int().min(1).default(65),
  /** Days one run may process, so catching up cannot outlive the job lock. */
  ROLLUP_MAX_DAYS_PER_RUN: z.coerce.number().int().min(1).default(14),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Problems that make a configuration unsafe to run in production: any secret
 * still holding its public development default, or a session secret that is too
 * short to resist guessing.
 */
export function productionProblems(candidate: Environment): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(DEV_DEFAULTS) as (keyof typeof DEV_DEFAULTS)[]) {
    if (candidate[key] === DEV_DEFAULTS[key]) {
      problems.push(`${key} is unset or still the public development default; set it explicitly`);
    }
  }
  if (candidate.NEXTAUTH_SECRET !== DEV_DEFAULTS.NEXTAUTH_SECRET && candidate.NEXTAUTH_SECRET.length < 32) {
    problems.push("NEXTAUTH_SECRET must be at least 32 characters in production");
  }
  return problems;
}

/**
 * Parse and validate environment variables. Throws on a malformed value, and in
 * production on any unsafe default (see productionProblems).
 *
 * `next build` also runs with NODE_ENV=production but has no runtime secrets,
 * so the production check is skipped for that phase only.
 */
export function loadEnvironment(source: NodeJS.ProcessEnv): Environment {
  let parsed: Environment;
  try {
    parsed = EnvironmentSchema.parse(source);
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

  if (parsed.NODE_ENV === "production" && source.NEXT_PHASE !== "phase-production-build") {
    const problems = productionProblems(parsed);
    if (problems.length > 0) {
      console.error("❌ Unsafe production configuration:");
      for (const problem of problems) console.error(`  - ${problem}`);
      throw new Error("Unsafe production configuration. See errors above.");
    }
  }
  return parsed;
}

export const env = loadEnvironment(process.env);
