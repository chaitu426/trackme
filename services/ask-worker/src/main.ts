import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { consume, createDepsFactory, requeueStale } from "./consumer.js";
import { startMetricsServer } from "./metrics.js";

/**
 * The ask worker entrypoint. One process = one consumer in the `ask-workers` group, so scaling out is running more copies.
 * It refuses to start when Ask is off or has no key, so a misconfiguration never silently answers with an empty engine.
 */

if (!env.ASK_ENABLED) {
  console.log("Ask worker idle: ASK_ENABLED is off.");
  process.exit(0);
}
if (!env.OPENAI_API_KEY?.trim()) {
  console.error("Ask worker cannot start: OPENAI_API_KEY is unset while ASK_ENABLED is on.");
  process.exit(1);
}

const redis = new Redis(env.REDIS_STATE_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});
const blocking = redis.duplicate();

const controller = new AbortController();
const metrics = startMetricsServer(env.ASK_METRICS_PORT);
const consumerName = `ask-w${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const deps = createDepsFactory(blocking, {
  apiKey: env.OPENAI_API_KEY,
  model: env.ASK_MODEL,
  maxTokens: env.ASK_MAX_TOKENS,
  maxSteps: env.ASK_MAX_STEPS,
});

const sweeper = setInterval(() => {
  void requeueStale(env.ASK_RUN_TIMEOUT_MS)
    .then((n) => n > 0 && console.warn(`ask worker: re-queued ${n} stale run(s)`))
    .catch((err) => console.error("ask worker: sweeper failed:", err));
}, Math.min(env.ASK_RUN_TIMEOUT_MS, 30_000));

async function shutdown(signal: string): Promise<void> {
  console.log(`ask worker: ${signal}, shutting down`);
  controller.abort();
  clearInterval(sweeper);
  await blocking.quit().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  metrics?.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(`ask worker: consuming as ${consumerName} (model ${env.ASK_MODEL})`);
consume({ redis: blocking, consumerName, deps, signal: controller.signal }).catch((err) => {
  console.error("ask worker crashed:", err);
  process.exit(1);
});
