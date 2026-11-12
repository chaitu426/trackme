export type BillingPlan = "free" | "pro";
export type BillingInterval = "month" | "year";
export type SubStatus = "trialing" | "active" | "past_due" | "canceled";

/** The subscription as the state machine sees it: no ids, no provider detail. */
export interface SubState {
  status: SubStatus;
  interval: BillingInterval;
  trialEnd: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: Date | null;
  canceledAt: Date | null;
  lastEventAt: Date | null;
}

interface EventBase {
  /** The provider's own event id: the idempotency key. */
  id: string;
  companyId: string;
  /** When the provider says it happened. An older event arriving after a newer one is ignored. */
  occurredAt: Date;
}

/**
 * Provider-agnostic events. Each gateway adapter turns its provider's webhooks into these; everything after
 * that (state machine, entitlements, invoices) sees only these.
 */
export type BillingEvent =
  | (EventBase & {
      type: "checkout.completed";
      interval: BillingInterval;
      providerCustomerId: string;
      providerSubscriptionId: string;
      periodStart: Date;
      periodEnd: Date;
      trialEnd: Date | null;
    })
  | (EventBase & {
      type: "invoice.paid";
      interval: BillingInterval;
      providerSubscriptionId: string;
      providerInvoiceId: string;
      amountMinor: number;
      currency: string;
      periodStart: Date;
      periodEnd: Date;
    })
  | (EventBase & {
      type: "invoice.payment_failed";
      providerSubscriptionId: string;
      providerInvoiceId: string;
      amountMinor: number;
      currency: string;
      reason: string;
    })
  | (EventBase & {
      type: "subscription.updated";
      providerSubscriptionId: string;
      interval?: BillingInterval;
      cancelAtPeriodEnd?: boolean;
    })
  | (EventBase & { type: "subscription.canceled"; providerSubscriptionId: string })
  | (EventBase & {
      type: "refund.created";
      providerInvoiceId: string;
      amountMinor: number;
      currency: string;
    });

export type BillingEventType = BillingEvent["type"];

/** Price of Pro in minor units. Placeholders: set the real ones with the env vars below, never in code. */
export interface Price {
  amountMinor: number;
  currency: string;
}

export function priceFor(interval: BillingInterval, env: Record<string, string | undefined> = process.env): Price {
  const currency = env.BILLING_CURRENCY?.trim() || "USD";
  const month = Number(env.BILLING_PRO_MONTHLY_MINOR) || 2900;
  const year = Number(env.BILLING_PRO_YEARLY_MINOR) || month * 10; // two months free
  return { amountMinor: interval === "year" ? year : month, currency };
}
