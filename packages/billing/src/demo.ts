import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError, type BillingGateway, type CheckoutInput, type SubscriptionRef } from "./gateway.js";
import { nextPeriodEnd } from "./state.js";
import { priceFor, type BillingEvent, type BillingInterval } from "./types.js";

/**
 * The demo gateway: a stand-in provider that moves no money. It behaves like a real one where it matters to our code:
 * a hosted checkout, test cards with different outcomes, and results delivered as SIGNED WEBHOOKS to our real webhook
 * endpoint, so signature checks, idempotency and ordering are exercised from the first day.
 *
 * It must never run in production by accident: `assertDemoAllowed` refuses unless explicitly allowed.
 */

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Whether the demo gateway may run here. The non-throwing form of `assertDemoAllowed`, for pages that should 404 instead. */
export function demoAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.BILLING_ALLOW_DEMO === "true";
}

export function assertDemoAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production" && env.BILLING_ALLOW_DEMO !== "true") {
    throw new Error(
      "The demo payment gateway is disabled in production. Set BILLING_PROVIDER to a real gateway, or BILLING_ALLOW_DEMO=true to run the demo on purpose."
    );
  }
}

/** The secret that signs demo checkout sessions and webhooks. Required in production; a fixed dev value otherwise. */
export function demoSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.BILLING_DEMO_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("BILLING_DEMO_SECRET (16+ characters) is required to run the demo gateway in production.");
  }
  return "dev-only-demo-billing-secret";
}

// ── Signing (the same scheme real providers use: a timestamp plus an HMAC of "timestamp.body") ──────────────────────

export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export function verifySignature(secret: string, body: string, header: string | undefined, now: Date): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(now.getTime() / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Checkout sessions: a signed, expiring token, so the demo needs no storage ──────────────────────────────────────

export interface DemoSession {
  companyId: string;
  interval: BillingInterval;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
}

export function signSession(secret: string, session: DemoSession): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(secret: string, token: string, now: Date): DemoSession | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DemoSession;
    return session.expiresAt > now.getTime() ? session : null;
  } catch {
    return null;
  }
}

// ── Test cards ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type CardOutcome = "success" | "declined" | "insufficient_funds" | "requires_authentication" | "unknown";

export const DEMO_CARDS: { number: string; outcome: Exclude<CardOutcome, "unknown">; label: string }[] = [
  { number: "4242 4242 4242 4242", outcome: "success", label: "Succeeds" },
  { number: "4000 0027 6000 3184", outcome: "requires_authentication", label: "Asks for authentication, then succeeds" },
  { number: "4000 0000 0000 0002", outcome: "declined", label: "Is declined" },
  { number: "4000 0000 0000 9995", outcome: "insufficient_funds", label: "Has insufficient funds" },
];

export function cardOutcome(number: string): CardOutcome {
  const digits = number.replace(/\D/g, "");
  return DEMO_CARDS.find((c) => c.number.replace(/\D/g, "") === digits)?.outcome ?? "unknown";
}

export const DECLINE_MESSAGE: Record<"declined" | "insufficient_funds" | "unknown", string> = {
  declined: "The card was declined.",
  insufficient_funds: "The card has insufficient funds.",
  unknown: "That is not a demo test card. Use one of the test cards listed on this page.",
};

// ── Events the demo provider emits ─────────────────────────────────────────────────────────────────────────────────

const eventId = () => `evt_demo_${randomUUID()}`;

/** A successful checkout: the subscription is created and the first invoice is paid. */
export function completionEvents(session: DemoSession, now: Date): BillingEvent[] {
  const price = priceFor(session.interval);
  const periodEnd = nextPeriodEnd(now, session.interval);
  const sub = `sub_demo_${session.companyId}`;
  return [
    {
      type: "checkout.completed",
      id: eventId(),
      companyId: session.companyId,
      occurredAt: now,
      interval: session.interval,
      providerCustomerId: `cus_demo_${session.companyId}`,
      providerSubscriptionId: sub,
      periodStart: now,
      periodEnd,
      trialEnd: null,
    },
    {
      type: "invoice.paid",
      id: eventId(),
      companyId: session.companyId,
      occurredAt: new Date(now.getTime() + 1),
      interval: session.interval,
      providerSubscriptionId: sub,
      providerInvoiceId: `in_demo_${randomUUID()}`,
      amountMinor: price.amountMinor,
      currency: price.currency,
      periodStart: now,
      periodEnd,
    },
  ];
}

/** Dev-only controls that act as the provider's clock, so renewals and failures can be tried without waiting. */
export function renewalEvent(args: { companyId: string; interval: BillingInterval; periodEnd: Date; now: Date; ok: boolean }): BillingEvent {
  const price = priceFor(args.interval);
  const sub = `sub_demo_${args.companyId}`;
  if (args.ok) {
    return {
      type: "invoice.paid",
      id: eventId(),
      companyId: args.companyId,
      occurredAt: args.now,
      interval: args.interval,
      providerSubscriptionId: sub,
      providerInvoiceId: `in_demo_${randomUUID()}`,
      amountMinor: price.amountMinor,
      currency: price.currency,
      periodStart: args.periodEnd,
      periodEnd: nextPeriodEnd(args.periodEnd, args.interval),
    };
  }
  return {
    type: "invoice.payment_failed",
    id: eventId(),
    companyId: args.companyId,
    occurredAt: args.now,
    providerSubscriptionId: sub,
    providerInvoiceId: `in_demo_${randomUUID()}`,
    amountMinor: price.amountMinor,
    currency: price.currency,
    reason: "card_declined",
  };
}

// ── Wire format: events <-> JSON (dates travel as ISO strings) ─────────────────────────────────────────────────────

export function serializeEvents(events: BillingEvent[]): string {
  return JSON.stringify({ object: "event_batch", events });
}

const DATE_FIELDS = ["occurredAt", "periodStart", "periodEnd", "trialEnd"] as const;

export function parseEvents(rawBody: string): BillingEvent[] {
  let parsed: { events?: Record<string, unknown>[] };
  try {
    parsed = JSON.parse(rawBody) as { events?: Record<string, unknown>[] };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.events)) return [];
  return parsed.events.flatMap((raw) => {
    if (typeof raw.id !== "string" || typeof raw.companyId !== "string" || typeof raw.type !== "string") return [];
    const event: Record<string, unknown> = { ...raw };
    for (const field of DATE_FIELDS) {
      if (typeof event[field] === "string") event[field] = new Date(event[field] as string);
    }
    if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) return [];
    return [event as unknown as BillingEvent];
  });
}

// ── The gateway ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DemoGatewayOptions {
  secret: string;
  /** Our own public origin, for the hosted checkout page. */
  appOrigin: string;
  /** Delivers signed events to our webhook endpoint. Defaults to an HTTP POST; tests inject their own. */
  deliver: (rawBody: string, signature: string) => Promise<void>;
  now?: () => Date;
}

export function createDemoGateway(options: DemoGatewayOptions): BillingGateway {
  const now = options.now ?? (() => new Date());
  const send = async (events: BillingEvent[]) => {
    const body = serializeEvents(events);
    await options.deliver(body, signPayload(options.secret, body, Math.floor(now().getTime() / 1000)));
  };

  return {
    id: "demo",

    async createCheckout(input: CheckoutInput) {
      const session: DemoSession = {
        companyId: input.companyId,
        interval: input.interval,
        email: input.email,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        expiresAt: now().getTime() + SESSION_TTL_MS,
      };
      const token = signSession(options.secret, session);
      return { url: `${options.appOrigin.replace(/\/$/, "")}/billing/demo/checkout?session=${encodeURIComponent(token)}`, sessionId: token.slice(-16) };
    },

    async cancelAtPeriodEnd(ref: SubscriptionRef) {
      await send([{ type: "subscription.updated", id: eventId(), companyId: ref.companyId, occurredAt: now(), providerSubscriptionId: ref.providerSubscriptionId ?? `sub_demo_${ref.companyId}`, cancelAtPeriodEnd: true }]);
    },

    async resume(ref: SubscriptionRef) {
      await send([{ type: "subscription.updated", id: eventId(), companyId: ref.companyId, occurredAt: now(), providerSubscriptionId: ref.providerSubscriptionId ?? `sub_demo_${ref.companyId}`, cancelAtPeriodEnd: false }]);
    },

    async changeInterval(ref) {
      await send([{ type: "subscription.updated", id: eventId(), companyId: ref.companyId, occurredAt: now(), providerSubscriptionId: ref.providerSubscriptionId ?? `sub_demo_${ref.companyId}`, interval: ref.interval }]);
    },

    verifyAndParseWebhook(rawBody, headers) {
      if (!verifySignature(options.secret, rawBody, headers["x-demo-signature"], now())) {
        throw new WebhookSignatureError();
      }
      return parseEvents(rawBody);
    },
  };
}

/** Used by the checkout and dev routes to hand events to our webhook as the demo provider would. */
export async function deliverSigned(url: string, rawBody: string, signature: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-signature": signature },
    body: rawBody,
  });
  if (!res.ok) {
    throw new Error(`Demo webhook delivery failed: ${res.status}`);
  }
}
