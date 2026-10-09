import cron from "node-cron";
import { Redis } from "ioredis";
import { env } from "@trackme/config";
import { runHourlyRollups } from "./jobs/hourly-rollups.js";
import { runDailyRollups } from "./jobs/daily-rollups.js";
import { runUsageMetering } from "./jobs/usage-metering.js";
import { runRetentionCleanup } from "./jobs/retention.js";
import { withDistributedLock } from "./lock.js";

console.log("⏱️ Scheduled Worker Daemon initialized.");

const redis = new Redis(env.REDIS_URL, {
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
      runHourlyRollups
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
      () => runDailyRollups().then(() => undefined)
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
      runUsageMetering
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
      runRetentionCleanup
    );
  } catch (err) {
    console.error("Failed running retention cleanup:", err);
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
