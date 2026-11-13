import type { BillingEvent, BillingInterval } from "./types.js";

export interface CheckoutInput {
  companyId: string;
  plan: "pro";
  interval: BillingInterval;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionRef {
  companyId: string;
  providerSubscriptionId: string | null;
}

/**
 * What every payment provider adapter implements. Our code never imports a provider's SDK outside its adapter:
 * adding Stripe or Razorpay means one new adapter and a webhook route, with no change to billing logic.
 *
 * Writes (cancel, resume, change interval) are requests to the provider. The result is learned the way a real
 * provider reports it: a webhook, parsed by `verifyAndParseWebhook`.
 */
export interface BillingGateway {
  readonly id: "demo" | "stripe" | "razorpay";
  createCheckout(input: CheckoutInput): Promise<{ url: string; sessionId: string }>;
  cancelAtPeriodEnd(ref: SubscriptionRef): Promise<void>;
  resume(ref: SubscriptionRef): Promise<void>;
  /** Takes effect at the next renewal; no proration. */
  changeInterval(ref: SubscriptionRef & { interval: BillingInterval }): Promise<void>;
  /** Throws `WebhookSignatureError` on a bad signature; returns no events for a type we do not use. */
  verifyAndParseWebhook(rawBody: string, headers: Record<string, string | undefined>): BillingEvent[];
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
