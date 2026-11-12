import cron from "node-cron";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { runHourlyRollups } from "./jobs/hourly-rollups.js";
import { runDailyRollups } from "./jobs/daily-rollups.js";
import { runUsageMetering } from "./jobs/usage-metering.js";
import { reclaimDeadEdgeQuota } from "./jobs/quota-reclaim.js";
import { runRetentionCleanup } from "./jobs/retention.js";
import { runBillingMaintenanceJob } from "./jobs/billing-maintenance.js";
import { runReconciliation } from "./jobs/reconciliation.js";
import { runErrorRegressions } from "./jobs/error-regressions.js";
import { runSourceMapRetention } from "./jobs/sourcemap-retention.js";
import { runPaymentPayloadRetention } from "./jobs/payment-payload-retention.js";
import { runRevenueLeakRollup } from "./jobs/revenue-leak-rollup.js";
import { publishAlertEvent } from "./jobs/alert-events.js";
import { createClickHouseNewGroupFetch, publishNewErrorGroups } from "./jobs/new-error-groups.js";
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
      instrumentJob("error_regressions", () =>
        runErrorRegressions((issue, release, now) => publishAlertEvent(redis, { type: "error_regression", siteId: issue.siteId, groupId: issue.groupId, release, at: now.toISOString() })).then(() => undefined)
      )
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

// 3b. Billing clock: ten minutes past every hour. Ends expired trials, grace periods and cancelled subscriptions.
cron.schedule("10 * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:billing_maintenance",
      300,
      "Billing Maintenance",
      instrumentJob("billing_maintenance", () => runBillingMaintenanceJob())
    );
  } catch (err) {
    console.error("Failed running billing maintenance:", err);
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
      instrumentJob("payment_failure_classifier", () => {
        const deps = createClickHouseClassifierDeps();
        // Each classified failure is also published on a Redis stream for the customer's own follow-up tooling (about the last 10,000 kept).
        deps.emit = async (rows) => {
          const pipe = redis.pipeline();
          for (const r of rows) {
            pipe.xadd("payments:failed", "MAXLEN", "~", 10000, "*", "siteId", r.siteId, "workspaceId", r.workspaceId, "paymentId", r.paymentId, "orderId", r.orderId, "category", r.category, "amountMinor", String(r.amountMinor), "currency", r.currency, "method", r.method, "userRef", r.userRef, "failedAt", new Date(r.failedAtMs).toISOString());
          }
          await pipe.exec();
        };
        return classifyPending(deps).then(() => undefined);
      })
    );
  } catch (err) {
    console.error("Failed classifying payment failures:", err);
  }
});

// Alert events: every minute, publish a "new error group" event for each issue first seen in the last 15 minutes (once per issue).
cron.schedule("* * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:new_error_groups",
      55,
      "New Error Groups",
      instrumentJob("new_error_groups", () =>
        publishNewErrorGroups({
          fetchRecent: createClickHouseNewGroupFetch(),
          claim: async (siteId, groupId) => (await redis.set(`alerts:newgroup:${siteId}:${groupId}`, "1", "EX", 7 * 86400, "NX")) === "OK",
          publish: (event) => publishAlertEvent(redis, event),
        }).then(() => undefined)
      )
    );
  } catch (err) {
    console.error("Failed publishing new error groups:", err);
  }
});

// Revenue-Leak Detector: hourly at :20, recompute today and yesterday of leak_sessions (one row per checkout session).
cron.schedule("20 * * * *", async () => {
  try {
    await withDistributedLock(
      redis,
      "lock:scheduled:revenue_leak_rollup",
      900,
      "Revenue Leak Rollup",
      instrumentJob("revenue_leak_rollup", () => runRevenueLeakRollup().then(() => undefined))
    );
  } catch (err) {
    console.error("Failed running revenue leak rollup:", err);
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
