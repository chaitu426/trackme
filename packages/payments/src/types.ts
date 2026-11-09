/**
 * The shape every gateway is normalised to. Adding a gateway means writing one adapter that produces these; nothing
 * downstream (storage, dashboards, the failure doctor) knows which gateway an event came from except by `gateway`.
 *
 * Money is an integer count of the currency's minor unit (paise, cents). Never a float.
 * Never carried: card numbers, CVV, full UPI ids, emails, phone numbers, auth tokens. An adapter that is handed them
 * must drop them; `bank` is a bank or PSP name, not an account, and `customerRef` is the gateway's own customer id.
 */

export const GATEWAY_IDS = ["razorpay", "stripe"] as const;
export type GatewayId = (typeof GATEWAY_IDS)[number];

export const PAYMENT_STATUSES = ["created", "authorized", "captured", "failed", "refunded", "disputed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["card", "upi", "netbanking", "wallet", "emi", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentEvent {
  gateway: GatewayId;
  /** The gateway's id for this notification: the idempotency key. The same id arriving twice is one event. */
  gatewayEventId: string;
  paymentId: string;
  /** The merchant's order id, which links the payment to the checkout in the browser. Empty when the gateway has none. */
  orderId: string;
  status: PaymentStatus;
  /** For a refund this is the amount refunded; for a dispute the amount disputed; otherwise the payment amount. */
  amountMinor: number;
  /** ISO 4217, upper case. */
  currency: string;
  method: PaymentMethod;
  /** The gateway's own failure code, scrubbed and capped; empty unless the payment failed. */
  failureCodeRaw: string;
  /** Bank or PSP name when the gateway reports one, never an account or UPI id. */
  bank: string;
  customerRef: string;
  /** When it happened at the gateway, ISO UTC. */
  createdAt: string;
  /** Merchant-supplied linkage copied from order metadata: which TrackMe session and user placed the order. */
  sessionRef: string;
  userRef: string;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "bad_signature" | "missing_signature" | "stale" | "malformed" };

/** The headers an adapter needs, looked up case-insensitively. */
export interface HeaderBag {
  get(name: string): string | null;
}

export interface PaymentGateway {
  id: GatewayId;
  /**
   * Checks that the notification really came from the gateway, in constant time, over the exact bytes received.
   * `now` is the current time in seconds, supplied so tests are deterministic.
   */
  verifyWebhook(rawBody: string, headers: HeaderBag, secret: string, nowSeconds?: number): VerifyResult;
  /** The gateway's id for this notification, from a header or the body. */
  eventId(rawBody: string, headers: HeaderBag): string;
  /** Zero or more normalised events from a verified body. Notifications that carry no payment information return []. */
  normalize(rawBody: string, eventId: string): PaymentEvent[];
}
