import { at, failureText, hmacHex, isoFromSeconds, method, minorUnits, parseJson, signaturesMatch, text } from "./common.js";
import type { PaymentGateway, PaymentStatus } from "./types.js";

/**
 * Stripe webhooks. `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]` where each v1 is HMAC-SHA256 of `<t>.<raw body>` with the
 * endpoint secret. Stripe signs a fresh timestamp for every delivery attempt, so a captured request can be refused once it
 * is more than five minutes old without dropping honest retries (a retry is signed again).
 */

export const STRIPE_TOLERANCE_SECONDS = 300;

const INTENT_EVENTS: Record<string, PaymentStatus> = {
  "payment_intent.created": "created",
  "payment_intent.amount_capturable_updated": "authorized",
  "payment_intent.succeeded": "captured",
  "payment_intent.payment_failed": "failed",
};

function parseSignatureHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d{9,12}$/.test(value)) t = Number(value);
    if (key === "v1") v1.push(value);
  }
  return { t, v1 };
}

/** card, upi and so on when the intent names exactly one method; otherwise unknown rather than a guess. */
function intentMethod(object: unknown): ReturnType<typeof method> {
  const failed = at(object, "last_payment_error", "payment_method", "type");
  if (typeof failed === "string") return method(failed);
  const types = at(object, "payment_method_types");
  return Array.isArray(types) && types.length === 1 ? method(types[0]) : "other";
}

export const stripe: PaymentGateway = {
  id: "stripe",

  verifyWebhook(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    const header = headers.get("stripe-signature");
    if (!header) return { ok: false, reason: "missing_signature" };
    const { t, v1 } = parseSignatureHeader(header);
    if (t === null || v1.length === 0) return { ok: false, reason: "malformed" };
    const expected = hmacHex(secret, `${t}.${rawBody}`);
    // Every candidate is compared (no early exit on the first match), so timing does not reveal which one was right.
    const matched = v1.map((candidate) => signaturesMatch(candidate, expected)).some(Boolean);
    if (!matched) return { ok: false, reason: "bad_signature" };
    return Math.abs(nowSeconds - t) > STRIPE_TOLERANCE_SECONDS ? { ok: false, reason: "stale" } : { ok: true };
  },

  eventId(rawBody) {
    return text(at(parseJson(rawBody), "id"), 100);
  },

  normalize(rawBody, eventId) {
    const body = parseJson(rawBody);
    const type = text(at(body, "type"), 64);
    const object = at(body, "data", "object");
    const created = at(body, "created");
    const fallbackMs = Date.now();

    const status = INTENT_EVENTS[type];
    if (status) {
      const amount = minorUnits(at(object, "amount"));
      const paymentId = text(at(object, "id"), 64);
      if (amount === null || !paymentId) return [];
      const code = [at(object, "last_payment_error", "code"), at(object, "last_payment_error", "decline_code")]
        .map((value) => failureText(value))
        .filter(Boolean)
        .join(":");
      return [
        {
          gateway: "stripe",
          gatewayEventId: eventId,
          paymentId,
          orderId: text(at(object, "metadata", "order_id"), 64),
          status,
          amountMinor: amount,
          currency: text(at(object, "currency"), 3).toUpperCase(),
          method: intentMethod(object),
          failureCodeRaw: status === "failed" ? code : "",
          bank: "",
          customerRef: text(at(object, "customer"), 64),
          createdAt: isoFromSeconds(created, fallbackMs),
          sessionRef: text(at(object, "metadata", "trackme_session"), 64),
          userRef: text(at(object, "metadata", "trackme_user"), 64),
        },
      ];
    }

    // One event per refund (its own amount), not charge.refunded, whose amount is the running total across refunds and
    // would be double counted if summed.
    if (type === "refund.created" || type === "charge.dispute.created") {
      const amount = minorUnits(at(object, "amount"));
      const paymentId = text(at(object, "payment_intent"), 64);
      if (amount === null || !paymentId) return [];
      return [
        {
          gateway: "stripe",
          gatewayEventId: eventId,
          paymentId,
          orderId: "",
          status: type === "refund.created" ? "refunded" : "disputed",
          amountMinor: amount,
          currency: text(at(object, "currency"), 3).toUpperCase(),
          method: "other",
          failureCodeRaw: "",
          bank: "",
          customerRef: "",
          createdAt: isoFromSeconds(created, fallbackMs),
          sessionRef: "",
          userRef: "",
        },
      ];
    }
    return [];
  },
};
