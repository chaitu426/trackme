import cron from "node-cron";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { runHourlyRollups } from "./jobs/hourly-rollups.js";
import { runDailyRollups } from "./jobs/daily-rollups.js";
import { runUsageMetering } from "./jobs/usage-metering.js";
import { reclaimDeadEdgeQuota } from "./jobs/quota-reclaim.js";
import { runRetentionCleanup } from "./jobs/retention.js";
import { runReconciliation } from "./jobs/reconciliation.js";
import { runErrorRegressions } from "./jobs/error-regressions.js";
import { runSourceMapRetention } from "./jobs/sourcemap-retention.js";
import { runPaymentPayloadRetention } from "./jobs/payment-payload-retention.js";
import { classifyPending } from "./jobs/payment-failure-classifier.js";
import { createClickHouseClassifierDeps } from "./jobs/payment-failure-classifier.db.js";
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

// 2b. Give back quota held by crashed ingestion edges: every 5 minutes.
cron.schedule("*/5 * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:quota_reclaim",
      120,
      "Quota Reclaim",
      instrumentJob("quota_reclaim", () => reclaimDeadEdgeQuota().then(() => undefined))
    );
  } catch (err) {
    console.error("Failed reclaiming dead-edge quota:", err);
  }
});

// 2c. Error regressions: every minute, reopen resolved issues that have occurred again. Cheap: one read of the
// (small) resolved list and one ClickHouse query per 500 issues over the 30-day error_events table.
cron.schedule("* * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:error_regressions",
      50,
      "Error Regressions",
      instrumentJob("error_regressions", () => runErrorRegressions().then(() => undefined))
    );
  } catch (err) {
    console.error("Failed checking error regressions:", err);
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

// 4b. Source map retention: 03:50 UTC daily. Deletes maps older than 90 days from the object store.
cron.schedule("50 3 * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:sourcemap_retention",
      600,
      "Source Map Retention",
      instrumentJob("sourcemap_retention", () => runSourceMapRetention().then(() => undefined))
    );
  } catch (err) {
    console.error("Failed running source map retention:", err);
  }
});

// Payment Failure Doctor: every minute, classify failed payments that have no classification yet (a failure is picked up
// one minute after it happens, so the errors and outcomes around it have arrived). A batch is at most 500 payments.
cron.schedule("* * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:payment_failure_classifier",
      55,
      "Payment Failure Classifier",
      instrumentJob("payment_failure_classifier", () => classifyPending(createClickHouseClassifierDeps()).then(() => undefined))
    );
  } catch (err) {
    console.error("Failed classifying payment failures:", err);
  }
});

// 4c. Raw payment payload retention: 04:00 UTC daily. Deletes webhook bodies older than 90 days from the object store.
cron.schedule("0 4 * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:payment_payload_retention",
      600,
      "Payment Payload Retention",
      instrumentJob("payment_payload_retention", () => runPaymentPayloadRetention().then(() => undefined))
    );
  } catch (err) {
    console.error("Failed running payment payload retention:", err);
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
