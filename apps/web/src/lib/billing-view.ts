/**
 * How the billing page words a company's state. Pure functions of the data and the clock, so the wording is testable and
 * the page cannot say something the data does not.
 */
export interface SubscriptionView {
  status: "trialing" | "active" | "past_due" | "canceled";
  interval: "month" | "year";
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: string | null;
  provider: string;
}

export type StatusTone = "info" | "success" | "warning" | "danger";

export interface PlanStatus {
  headline: string;
  detail: string;
  tone: StatusTone;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDate(iso: string | Date | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Whole days from `now` to `to`, never below zero. */
export function daysUntil(to: string | Date | null, now: Date): number {
  if (!to) return 0;
  return Math.max(0, Math.ceil((new Date(to).getTime() - now.getTime()) / DAY_MS));
}

export function formatPrice(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(major) ? 0 : 2 }).format(major);
}

/** What the yearly price saves against twelve monthly ones, as a share. */
export function yearlySavingPercent(monthMinor: number, yearMinor: number): number {
  if (monthMinor <= 0) return 0;
  return Math.max(0, Math.round((1 - yearMinor / (monthMinor * 12)) * 100));
}

export function describeStatus(plan: string, sub: SubscriptionView | null, grandfathered: boolean, now: Date): PlanStatus {
  if (!sub) {
    return grandfathered
      ? { headline: "Pro, included during the beta", detail: "This workspace was here before plans existed, so Pro is on us while the beta runs.", tone: "info" }
      : { headline: "Free plan", detail: "One website, 50,000 events a month. Upgrade whenever you need more.", tone: "info" };
  }
  switch (sub.status) {
    case "trialing": {
      const days = daysUntil(sub.trialEnd, now);
      return {
        headline: `Pro trial, ${days} ${days === 1 ? "day" : "days"} left`,
        detail: `Ends ${formatDate(sub.trialEnd)}, then the workspace returns to Free unless you subscribe.`,
        tone: days <= 3 ? "warning" : "info",
      };
    }
    case "active":
      return sub.cancelAtPeriodEnd
        ? { headline: `Pro until ${formatDate(sub.currentPeriodEnd)}`, detail: "Your subscription will not renew. Resume it any time before then.", tone: "warning" }
        : { headline: "Pro", detail: `Renews ${formatDate(sub.currentPeriodEnd)}, billed ${sub.interval === "year" ? "yearly" : "monthly"}.`, tone: "success" };
    case "past_due": {
      const days = daysUntil(sub.graceEndsAt, now);
      return {
        headline: "Payment failed",
        detail: `Pro stays on for ${days} more ${days === 1 ? "day" : "days"} (until ${formatDate(sub.graceEndsAt)}) while we retry. Update the card to keep it.`,
        tone: "danger",
      };
    }
    case "canceled":
      return plan === "pro"
        ? { headline: "Pro", detail: "", tone: "success" }
        : { headline: "Free plan", detail: "Your Pro subscription has ended. Your data is kept; some features are locked until you subscribe again.", tone: "info" };
  }
}
