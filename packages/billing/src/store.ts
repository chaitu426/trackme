import { AppError, eventQuotaFor } from "@trackme/contracts";
import { db, companies, workspaces, sites, subscriptions, invoices, billingEvents, billingCustomers, eq, and, desc, inArray } from "@trackme/db";
import { TRIAL_DAYS, addDays, planFor, reduce, tick } from "./state.js";
import type { BillingEvent, BillingInterval, BillingPlan, SubState, SubStatus } from "./types.js";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SubscriptionRow = typeof subscriptions.$inferSelect;

const toState = (row: SubscriptionRow): SubState => ({
  status: row.status as SubStatus,
  interval: row.interval === "year" ? "year" : "month",
  trialEnd: row.trialEnd,
  currentPeriodStart: row.currentPeriodStart,
  currentPeriodEnd: row.currentPeriodEnd,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  graceEndsAt: row.graceEndsAt,
  canceledAt: row.canceledAt,
  lastEventAt: row.lastEventAt,
});

/**
 * Puts a company on a plan: the plan itself, the monthly event quota the edge enforces for it, and the same quota on
 * its workspaces. Returns the public-key hashes of the company's sites so the caller can purge the edge's cache.
 */
export async function setCompanyPlan(tx: Tx, companyId: string, plan: BillingPlan): Promise<string[]> {
  const quota = eventQuotaFor(plan);
  await tx.update(companies).set({ plan, monthlyEventQuota: quota, updatedAt: new Date() }).where(eq(companies.id, companyId));
  await tx.update(workspaces).set({ monthlyEventQuota: quota, updatedAt: new Date() }).where(eq(workspaces.companyId, companyId));
  const rows = await tx
    .select({ hash: sites.publicKeyHash })
    .from(sites)
    .innerJoin(workspaces, eq(workspaces.id, sites.workspaceId))
    .where(eq(workspaces.companyId, companyId));
  return rows.flatMap((r) => (r.hash ? [r.hash] : []));
}

export interface ProcessResult {
  result: "applied" | "duplicate" | "stale" | "unknown_company";
  companyId: string;
  plan: BillingPlan | null;
  planChanged: boolean;
  /** Public-key hashes to purge from the edge cache when the plan changed. */
  purge: string[];
}

const noChange = (result: ProcessResult["result"], companyId: string): ProcessResult => ({ result, companyId, plan: null, planChanged: false, purge: [] });

/**
 * Applies one provider event. Idempotent: the provider's event id is a unique key, so a redelivered event does nothing.
 * Everything happens in one transaction with the company row locked, so two events for one company cannot interleave.
 */
export async function processBillingEvent(provider: string, event: BillingEvent, now: Date = new Date()): Promise<ProcessResult> {
  return db.transaction(async (tx) => {
    const [company] = await tx
      .select({ id: companies.id, plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, event.companyId))
      .for("update")
      .limit(1);

    const recorded = await tx
      .insert(billingEvents)
      .values({
        provider,
        providerEventId: event.id,
        type: event.type,
        companyId: company ? company.id : null,
        payload: JSON.parse(JSON.stringify(event)) as Record<string, unknown>,
        outcome: company ? "applied" : "ignored_unknown_company",
      })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });
    if (recorded.length === 0) return noChange("duplicate", event.companyId);
    if (!company) return noChange("unknown_company", event.companyId);

    const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, company.id)).limit(1);
    const { sub, applied } = reduce(row ? toState(row) : null, event, now);
    if (!applied || !sub) {
      await tx.update(billingEvents).set({ outcome: "ignored_stale" }).where(eq(billingEvents.id, recorded[0]!.id));
      return noChange("stale", company.id);
    }

    const providerSubscriptionId = "providerSubscriptionId" in event ? event.providerSubscriptionId : (row?.providerSubscriptionId ?? null);
    const values = {
      provider,
      providerSubscriptionId,
      plan: "pro",
      interval: sub.interval,
      status: sub.status,
      trialEnd: sub.trialEnd,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      graceEndsAt: sub.graceEndsAt,
      canceledAt: sub.canceledAt,
      lastEventAt: sub.lastEventAt,
      updatedAt: now,
    };
    if (row) await tx.update(subscriptions).set(values).where(eq(subscriptions.id, row.id));
    else await tx.insert(subscriptions).values({ companyId: company.id, ...values });

    if (event.type === "checkout.completed") {
      await tx
        .insert(billingCustomers)
        .values({ companyId: company.id, provider, providerCustomerId: event.providerCustomerId })
        .onConflictDoUpdate({ target: billingCustomers.companyId, set: { provider, providerCustomerId: event.providerCustomerId } });
    }
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const paid = event.type === "invoice.paid";
      await tx
        .insert(invoices)
        .values({
          companyId: company.id,
          provider,
          providerInvoiceId: event.providerInvoiceId,
          number: `INV-${event.occurredAt.toISOString().slice(0, 7).replace("-", "")}-${event.providerInvoiceId.slice(-6).toUpperCase()}`,
          amountMinor: event.amountMinor,
          currency: event.currency,
          status: paid ? "paid" : "failed",
          periodStart: paid ? event.periodStart : null,
          periodEnd: paid ? event.periodEnd : null,
          paidAt: paid ? event.occurredAt : null,
        })
        .onConflictDoUpdate({
          target: [invoices.provider, invoices.providerInvoiceId],
          set: { status: paid ? "paid" : "failed", paidAt: paid ? event.occurredAt : null },
        });
    }
    if (event.type === "refund.created") {
      await tx
        .update(invoices)
        .set({ status: "refunded" })
        .where(and(eq(invoices.provider, provider), eq(invoices.providerInvoiceId, event.providerInvoiceId)));
    }

    const plan = planFor(sub, now);
    if (plan === company.plan) return { result: "applied", companyId: company.id, plan, planChanged: false, purge: [] };
    const purge = await setCompanyPlan(tx, company.id, plan);
    return { result: "applied", companyId: company.id, plan, planChanged: true, purge };
  });
}

export interface MaintenanceResult {
  checked: number;
  changed: { companyId: string; from: SubStatus; to: SubStatus; plan: BillingPlan }[];
  purge: string[];
}

/**
 * The time-driven half of billing, run nightly: ends trials, grace periods and cancel-at-period-end subscriptions whose
 * time has come, and moves the company to Free. Each subscription is handled in its own transaction, so one failure
 * leaves the others done.
 */
export async function runBillingMaintenance(now: Date = new Date()): Promise<MaintenanceResult> {
  const live = await db
    .select({ id: subscriptions.id, companyId: subscriptions.companyId })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["trialing", "past_due", "active"]));

  const result: MaintenanceResult = { checked: live.length, changed: [], purge: [] };
  for (const { id, companyId } of live) {
    try {
      await db.transaction(async (tx) => {
        const [company] = await tx.select({ id: companies.id, plan: companies.plan }).from(companies).where(eq(companies.id, companyId)).for("update").limit(1);
        const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
        if (!company || !row) return;
        const before = toState(row);
        const after = tick(before, now);
        if (after === before) return;

        await tx
          .update(subscriptions)
          .set({ status: after.status, cancelAtPeriodEnd: after.cancelAtPeriodEnd, graceEndsAt: after.graceEndsAt, canceledAt: after.canceledAt, updatedAt: now })
          .where(eq(subscriptions.id, id));
        await tx
          .insert(billingEvents)
          .values({
            provider: "internal",
            providerEventId: `tick:${id}:${before.status}->${after.status}:${now.toISOString().slice(0, 10)}`,
            type: "subscription.expired",
            companyId,
            payload: { from: before.status, to: after.status },
          })
          .onConflictDoNothing();

        const plan = planFor(after, now);
        if (plan !== company.plan) result.purge.push(...(await setCompanyPlan(tx, companyId, plan)));
        result.changed.push({ companyId, from: before.status, to: after.status, plan });
      });
    } catch (error) {
      console.error(`[billing] maintenance failed for subscription ${id}:`, error);
    }
  }
  return result;
}

/**
 * Starts the one free Pro trial a company gets, with no card. A subscription row of any kind means the trial is used.
 */
export async function startTrial(companyId: string, now: Date = new Date()): Promise<{ trialEnd: Date; purge: string[] }> {
  return db.transaction(async (tx) => {
    const [company] = await tx
      .select({ id: companies.id, plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for("update")
      .limit(1);
    if (!company) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found.");
    if (company.plan === "pro") throw new AppError(409, "ALREADY_PRO", "This company is already on Pro.");
    const [existing] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
    if (existing) throw new AppError(409, "TRIAL_USED", "This company has already used its free trial.");

    const trialEnd = addDays(now, TRIAL_DAYS);
    await tx.insert(subscriptions).values({
      companyId,
      provider: "internal",
      plan: "pro",
      interval: "month",
      status: "trialing",
      trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      lastEventAt: now,
    });
    const purge = await setCompanyPlan(tx, companyId, "pro");
    return { trialEnd, purge };
  });
}

export interface BillingSummary {
  plan: BillingPlan;
  grandfathered: boolean;
  subscription: {
    status: SubStatus;
    interval: BillingInterval;
    trialEnd: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    graceEndsAt: Date | null;
    provider: string;
    providerSubscriptionId: string | null;
  } | null;
  /** True when this company has never had a subscription, so a free trial is still available. */
  trialAvailable: boolean;
  invoices: { id: string; number: string; amountMinor: number; currency: string; status: string; paidAt: Date | null; createdAt: Date }[];
}

export async function getBillingSummary(companyId: string): Promise<BillingSummary> {
  const [company] = await db.select({ plan: companies.plan, grandfathered: companies.grandfathered }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new AppError(404, "COMPANY_NOT_FOUND", "Company not found.");
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
  const rows = await db
    .select({ id: invoices.id, number: invoices.number, amountMinor: invoices.amountMinor, currency: invoices.currency, status: invoices.status, paidAt: invoices.paidAt, createdAt: invoices.createdAt })
    .from(invoices)
    .where(eq(invoices.companyId, companyId))
    .orderBy(desc(invoices.createdAt))
    .limit(12);
  return {
    plan: company.plan === "pro" ? "pro" : "free",
    grandfathered: company.grandfathered,
    subscription: sub
      ? {
          status: sub.status as SubStatus,
          interval: sub.interval === "year" ? "year" : "month",
          trialEnd: sub.trialEnd,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          graceEndsAt: sub.graceEndsAt,
          provider: sub.provider,
          providerSubscriptionId: sub.providerSubscriptionId,
        }
      : null,
    trialAvailable: !sub && company.plan !== "pro",
    invoices: rows,
  };
}
