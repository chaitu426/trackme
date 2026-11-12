import type { BillingEvent, BillingPlan, SubState } from "./types.js";

export const TRIAL_DAYS = 14;
/** How long a company keeps Pro after a payment fails, while the provider retries. */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY_MS);

/**
 * The plan a subscription entitles its company to right now. A pure function of the subscription and the clock,
 * so it can be checked anywhere (the webhook, the nightly job, the billing page) and always agrees.
 */
export function planFor(sub: SubState | null, now: Date): BillingPlan {
  if (!sub) return "free";
  switch (sub.status) {
    case "trialing":
      return sub.trialEnd && sub.trialEnd > now ? "pro" : "free";
    case "active":
      return sub.cancelAtPeriodEnd && sub.currentPeriodEnd && sub.currentPeriodEnd <= now ? "free" : "pro";
    case "past_due":
      return sub.graceEndsAt && sub.graceEndsAt > now ? "pro" : "free";
    case "canceled":
      return "free";
  }
}

const latest = (a: Date | null, b: Date): Date => (a && a > b ? a : b);

const blank = (event: BillingEvent): SubState => ({
  status: "active",
  interval: "month",
  trialEnd: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  graceEndsAt: null,
  canceledAt: null,
  lastEventAt: event.occurredAt,
});

/**
 * Applies a provider event. Returns `applied: false` (and the subscription unchanged) for an event that is older than
 * one already applied, or that makes no sense without a subscription. Never throws: a bad event cannot wedge billing.
 */
export function reduce(sub: SubState | null, event: BillingEvent, now: Date): { sub: SubState | null; applied: boolean } {
  if (sub?.lastEventAt && event.occurredAt < sub.lastEventAt) {
    return { sub, applied: false };
  }
  const seen = latest(sub?.lastEventAt ?? null, event.occurredAt);

  switch (event.type) {
    case "checkout.completed": {
      const trialing = event.trialEnd !== null && event.trialEnd > now;
      return {
        applied: true,
        sub: {
          status: trialing ? "trialing" : "active",
          interval: event.interval,
          trialEnd: event.trialEnd,
          currentPeriodStart: event.periodStart,
          currentPeriodEnd: event.periodEnd,
          cancelAtPeriodEnd: false,
          graceEndsAt: null,
          canceledAt: null,
          lastEventAt: seen,
        },
      };
    }
    case "invoice.paid": {
      // A payment that arrives before its checkout event creates the subscription, so ordering cannot lose it.
      const base = sub ?? blank(event);
      return {
        applied: true,
        sub: {
          ...base,
          status: "active",
          interval: event.interval,
          currentPeriodStart: event.periodStart,
          currentPeriodEnd: event.periodEnd,
          graceEndsAt: null,
          canceledAt: null,
          lastEventAt: seen,
        },
      };
    }
    case "invoice.payment_failed": {
      if (!sub || sub.status === "canceled") return { sub, applied: false };
      return {
        applied: true,
        sub: {
          ...sub,
          status: "past_due",
          // The first failure starts the clock; retries while already past due do not extend it.
          graceEndsAt: sub.status === "past_due" && sub.graceEndsAt ? sub.graceEndsAt : addDays(now, GRACE_DAYS),
          lastEventAt: seen,
        },
      };
    }
    case "subscription.updated": {
      if (!sub || sub.status === "canceled") return { sub, applied: false };
      return {
        applied: true,
        sub: {
          ...sub,
          interval: event.interval ?? sub.interval,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? sub.cancelAtPeriodEnd,
          lastEventAt: seen,
        },
      };
    }
    case "subscription.canceled": {
      if (!sub) return { sub, applied: false };
      return {
        applied: true,
        sub: { ...sub, status: "canceled", cancelAtPeriodEnd: false, graceEndsAt: null, canceledAt: event.occurredAt, lastEventAt: seen },
      };
    }
    case "refund.created":
      // A refund is recorded on the invoice; it does not change the subscription.
      return { sub, applied: true };
  }
}

/**
 * Time-driven transitions, run by the nightly job: a trial that ran out, a grace period that ran out, a subscription
 * set to cancel whose paid period has ended. Returns the same object when nothing is due.
 */
export function tick(sub: SubState, now: Date): SubState {
  const end = (): SubState => ({ ...sub, status: "canceled", cancelAtPeriodEnd: false, graceEndsAt: null, canceledAt: now });
  if (sub.status === "trialing" && sub.trialEnd && sub.trialEnd <= now) return end();
  if (sub.status === "past_due" && sub.graceEndsAt && sub.graceEndsAt <= now) return end();
  if (sub.status === "active" && sub.cancelAtPeriodEnd && sub.currentPeriodEnd && sub.currentPeriodEnd <= now) return end();
  return sub;
}

/** The next billing period after one that ends at `from`. */
export function nextPeriodEnd(from: Date, interval: "month" | "year"): Date {
  const d = new Date(from.getTime());
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
