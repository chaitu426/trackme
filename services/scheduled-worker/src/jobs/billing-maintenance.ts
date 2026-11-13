import { runBillingMaintenance } from "@trackme/billing";

/**
 * Hourly billing clock: ends trials, past-due grace periods and cancel-at-period-end subscriptions whose time has
 * come, and moves those companies to Free (plan and monthly event quota). The rules live in @trackme/billing so the
 * web app and this job always agree.
 *
 * The edge keeps its own short-lived copy of each site's quota, so a downgrade reaches ingestion within that cache's
 * lifetime even though this job cannot purge it; the web app purges immediately on webhook-driven changes.
 */
export async function runBillingMaintenanceJob(now: Date = new Date()): Promise<void> {
  const result = await runBillingMaintenance(now);
  for (const change of result.changed) {
    console.log(`💳 Billing: company ${change.companyId} ${change.from} -> ${change.to}, plan ${change.plan}`);
  }
  console.log(`💳 Billing maintenance: ${result.checked} subscription(s) checked, ${result.changed.length} changed.`);
}
