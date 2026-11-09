import { at, failureText, hmacHex, isoFromSeconds, isoOrEmpty, method, minorUnits, parseJson, sha256Hex, signaturesMatch, text } from "./common.js";
import type { PaymentEvent, PaymentGateway, PaymentStatus } from "./types.js";

/**
 * Razorpay webhooks. The body is signed with HMAC-SHA256 over the exact bytes, with the webhook secret, hex in
 * `X-Razorpay-Signature`; `X-Razorpay-Event-Id` identifies the notification.
 *
 * No replay window: Razorpay retries a failed delivery for up to 24 hours with the same signature, so rejecting old
 * notifications would drop real ones. Replays are made harmless by idempotency on the event id instead.
 */

const PAYMENT_EVENTS: Record<string, PaymentStatus> = {
  "payment.authorized": "authorized",
  "payment.captured": "captured",
  "payment.failed": "failed",
};

/** Failure codes only (source, step, reason, code). The free-text description is not kept: it can name the customer. */
function failureCode(entity: unknown): string {
  return ["error_source", "error_step", "error_reason", "error_code"]
    .map((key) => failureText(at(entity, key)))
    .filter(Boolean)
    .join(":");
}

/** A UPI id is personal data; only the handle after the @ (the PSP, such as "oksbi") is kept, and a card keeps its network. */
function bankOf(entity: unknown): string {
  const vpa = text(at(entity, "vpa"), 80);
  const handle = vpa.includes("@") ? vpa.slice(vpa.indexOf("@") + 1) : "";
  return text(at(entity, "bank"), 40) || text(at(entity, "wallet"), 40) || handle.slice(0, 40) || text(at(entity, "card", "network"), 20);
}

export const razorpay: PaymentGateway = {
  id: "razorpay",

  verifyWebhook(rawBody, headers, secret) {
    const received = headers.get("x-razorpay-signature");
    if (!received) return { ok: false, reason: "missing_signature" };
    return signaturesMatch(received.trim(), hmacHex(secret, rawBody)) ? { ok: true } : { ok: false, reason: "bad_signature" };
  },

  eventId(rawBody, headers) {
    return text(headers.get("x-razorpay-event-id"), 100) || `body_${sha256Hex(rawBody).slice(0, 40)}`;
  },

  normalize(rawBody, eventId) {
    const body = parseJson(rawBody);
    const type = text(at(body, "event"), 64);
    const fallbackMs = Date.now();

    const status = PAYMENT_EVENTS[type];
    if (status) {
      const entity = at(body, "payload", "payment", "entity");
      const amount = minorUnits(at(entity, "amount"));
      const paymentId = text(at(entity, "id"), 64);
      if (amount === null || !paymentId) return [];
      return [
        {
          gateway: "razorpay",
          gatewayEventId: eventId,
          paymentId,
          orderId: text(at(entity, "order_id"), 64),
          status,
          amountMinor: amount,
          currency: text(at(entity, "currency"), 3).toUpperCase(),
          method: method(at(entity, "method")),
          failureCodeRaw: status === "failed" ? failureCode(entity) : "",
          bank: bankOf(entity),
          customerRef: text(at(entity, "customer_id"), 64),
          createdAt: isoFromSeconds(at(entity, "created_at") ?? at(body, "created_at"), fallbackMs),
          sessionRef: text(at(entity, "notes", "trackme_session"), 64),
          userRef: text(at(entity, "notes", "trackme_user"), 64),
          reason: "",
          dueBy: "",
        },
      ];
    }

    if (type === "refund.processed") {
      const entity = at(body, "payload", "refund", "entity");
      const amount = minorUnits(at(entity, "amount"));
      const paymentId = text(at(entity, "payment_id"), 64);
      if (amount === null || !paymentId) return [];
      return [refundOrDispute("refunded", eventId, paymentId, amount, entity, at(body, "created_at"), fallbackMs)];
    }

    if (type === "payment.dispute.created") {
      const entity = at(body, "payload", "dispute", "entity");
      const amount = minorUnits(at(entity, "amount"));
      const paymentId = text(at(entity, "payment_id"), 64);
      if (amount === null || !paymentId) return [];
      return [refundOrDispute("disputed", eventId, paymentId, amount, entity, at(body, "created_at"), fallbackMs)];
    }

    // order.paid, refund.created, dispute updates and everything else carry nothing we would count twice.
    return [];
  },
};

function refundOrDispute(
  status: "refunded" | "disputed",
  eventId: string,
  paymentId: string,
  amount: number,
  entity: unknown,
  bodyCreated: unknown,
  fallbackMs: number
): PaymentEvent {
  return {
    gateway: "razorpay",
    gatewayEventId: eventId,
    paymentId,
    orderId: "",
    status,
    amountMinor: amount,
    currency: text(at(entity, "currency"), 3).toUpperCase(),
    method: "other",
    failureCodeRaw: "",
    bank: "",
    customerRef: "",
    createdAt: isoFromSeconds(at(entity, "created_at") ?? bodyCreated, fallbackMs),
    sessionRef: text(at(entity, "notes", "trackme_session"), 64),
    userRef: text(at(entity, "notes", "trackme_user"), 64),
    reason: status === "disputed" ? failureText(at(entity, "reason_code")) : failureText(at(entity, "notes", "reason")),
    dueBy: status === "disputed" ? isoOrEmpty(at(entity, "respond_by")) : "",
  };
}
