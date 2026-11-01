import cron from "node-cron";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { runHourlyRollups } from "./jobs/hourly-rollups.js";
import { runDailyRollups } from "./jobs/daily-rollups.js";
import { runUsageMetering } from "./jobs/usage-metering.js";
import { runRetentionCleanup } from "./jobs/retention.js";
import { runReconciliation } from "./jobs/reconciliation.js";
import { instrumentJob, reconciliationFindings, startMetricsServer } from "./metrics.js";
import { withDistributedLock } from "./lock.js";

console.log("⏱️ Scheduled Worker Daemon initialized.");
startMetricsServer(env.SCHEDULER_METRICS_PORT);

const redis = new Redis(env.REDIS_STATE_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
});

// 1. Hourly Rollups: 5 minutes past every hour
cron.schedule("5 * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:hourly_rollups",
      600,
      "Hourly Rollups",
      instrumentJob("hourly_rollups", runHourlyRollups)
    );
  } catch (err) {
    console.error("Failed running hourly rollups:", err);
  }
});

// 2. Daily rollups: every 15 minutes. Each run resumes from where the rollup
// tables end, so this keeps today's numbers fresh and repairs any downtime.
cron.schedule("2,17,32,47 * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:daily_rollups",
      900,
      "Daily Rollups",
      instrumentJob("daily_rollups", () => runDailyRollups().then(() => undefined))
    );
  } catch (err) {
    console.error("Failed running daily rollups:", err);
  }
});

// 3. Usage Metering Sync: Every 15 minutes
cron.schedule("*/15 * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:usage_metering",
      300,
      "Usage Metering",
      instrumentJob("usage_metering", runUsageMetering)
    );
  } catch (err) {
    console.error("Failed running usage metering:", err);
  }
});

// 4. Retention cleanup: 03:30 UTC daily
cron.schedule("30 3 * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:retention",
      1800,
      "Retention Cleanup",
      instrumentJob("retention", runRetentionCleanup)
    );
  } catch (err) {
    console.error("Failed running retention cleanup:", err);
  }
});

// 5. Reconciliation: 04:20 UTC daily. Compares the aggregate tables with the raw events they
// were built from and checks for duplicate event ids. Only meaningful once events_v2 is fed.
const reconcile = instrumentJob("reconciliation", async () => {
  const { mismatches, duplicates, alerts } = await runReconciliation();
  reconciliationFindings.set({ kind: "aggregate_drift" }, mismatches.length);
  reconciliationFindings.set({ kind: "duplicate_days" }, duplicates.filter((d) => d.rate > 0.001).length);
  // A failed run is the alert: it shows in job history and stops the success heartbeat.
  if (alerts.length > 0) throw new Error(`reconciliation found ${alerts.length} problem(s); see log lines above`);
});

cron.schedule("20 4 * * *", async () => {
  if (env.WORKER_WRITE_V2 === "off") return;
  try {
    await withDistributedLock(redis, "lock:scheduled:reconciliation", 1800, "Reconciliation", reconcile);
  } catch (err) {
    console.error("Reconciliation reported problems:", err);
  }
});

// Run an initial quick pass on startup in dev
if (process.env.NODE_ENV !== "production") {
  console.log("🛠️ Running initial background pass in development...");
  withDistributedLock(
    redis,
    "lock:scheduled:usage_metering",
    120,
    "Initial Usage Metering Pass",
    runUsageMetering
  ).catch(() => {});
}
