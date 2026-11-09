import { test } from "node:test";
import assert from "node:assert/strict";
import { getGateway, hmacHex, razorpay, signaturesMatch, stripe, STRIPE_TOLERANCE_SECONDS, type HeaderBag } from "./index.js";

const headers = (init: Record<string, string>): HeaderBag => ({
  get: (name) => init[name.toLowerCase()] ?? null,
});

/* Signatures below were produced by openssl, an independent HMAC implementation, not by the code under test. */
const STRIPE_SECRET = "whsec_test";
const STRIPE_BODY = '{"id":"evt_1"}';
const STRIPE_SIG = "c89214b5b5da833daed6f0b8c5bb6bd58cea9022bd80ccc78230f3942d632925";
const RZP_SECRET = "rzp_secret";
const RZP_BODY = '{"event":"payment.captured"}';
const RZP_SIG = "0ea09d611215f3d22f53207c37444d3938ba1bd74925b558d3759f86683e48a5";

test("the HMAC matches openssl's for both signing schemes", () => {
  assert.equal(hmacHex(STRIPE_SECRET, `1700000000.${STRIPE_BODY}`), STRIPE_SIG);
  assert.equal(hmacHex(RZP_SECRET, RZP_BODY), RZP_SIG);
});

test("signature comparison is exact, case-insensitive on hex, and safe on bad input", () => {
  assert.equal(signaturesMatch(RZP_SIG, RZP_SIG), true);
  assert.equal(signaturesMatch(RZP_SIG.toUpperCase(), RZP_SIG), true);
  for (const bad of ["", "zz", RZP_SIG.slice(0, -2), RZP_SIG + "00", RZP_SIG.replace(/.$/, "0"), "not hex at all"]) {
    assert.equal(signaturesMatch(bad, RZP_SIG), false, bad);
  }
});

test("Razorpay: a correct signature passes; a wrong secret, edited body or missing header does not", () => {
  const ok = headers({ "x-razorpay-signature": RZP_SIG });
  assert.deepEqual(razorpay.verifyWebhook(RZP_BODY, ok, RZP_SECRET), { ok: true });
  assert.deepEqual(razorpay.verifyWebhook(RZP_BODY, ok, "other_secret"), { ok: false, reason: "bad_signature" });
  assert.deepEqual(razorpay.verifyWebhook(RZP_BODY.replace("captured", "failed"), ok, RZP_SECRET), { ok: false, reason: "bad_signature" });
  assert.deepEqual(razorpay.verifyWebhook(RZP_BODY, headers({}), RZP_SECRET), { ok: false, reason: "missing_signature" });
});

test("Razorpay does not reject an old notification (its retries last 24 hours)", () => {
  const ok = headers({ "x-razorpay-signature": RZP_SIG });
  assert.deepEqual(razorpay.verifyWebhook(RZP_BODY, ok, RZP_SECRET, 4_000_000_000), { ok: true });
});

test("Stripe: a correct signature inside the tolerance passes", () => {
  const h = headers({ "stripe-signature": `t=1700000000,v1=${STRIPE_SIG}` });
  assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, h, STRIPE_SECRET, 1700000100), { ok: true });
  assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, h, STRIPE_SECRET, 1700000000 + STRIPE_TOLERANCE_SECONDS), { ok: true });
});

test("Stripe: a replay older than five minutes is refused, even with a valid signature", () => {
  const h = headers({ "stripe-signature": `t=1700000000,v1=${STRIPE_SIG}` });
  assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, h, STRIPE_SECRET, 1700000000 + STRIPE_TOLERANCE_SECONDS + 1), { ok: false, reason: "stale" });
  assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, h, STRIPE_SECRET, 1700000000 - STRIPE_TOLERANCE_SECONDS - 1), { ok: false, reason: "stale" });
});

test("Stripe: tampering, the wrong secret, a moved timestamp, and malformed headers are all refused", () => {
  const good = `t=1700000000,v1=${STRIPE_SIG}`;
  const now = 1700000050;
  assert.equal(stripe.verifyWebhook(STRIPE_BODY.replace("evt_1", "evt_2"), headers({ "stripe-signature": good }), STRIPE_SECRET, now).ok, false);
  assert.equal(stripe.verifyWebhook(STRIPE_BODY, headers({ "stripe-signature": good }), "whsec_other", now).ok, false);
  assert.equal(stripe.verifyWebhook(STRIPE_BODY, headers({ "stripe-signature": `t=1700000001,v1=${STRIPE_SIG}` }), STRIPE_SECRET, now).ok, false);
  assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, headers({}), STRIPE_SECRET, now), { ok: false, reason: "missing_signature" });
  for (const bad of ["garbage", "t=abc,v1=00", `v1=${STRIPE_SIG}`, "t=1700000000"]) {
    assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, headers({ "stripe-signature": bad }), STRIPE_SECRET, now), { ok: false, reason: "malformed" }, bad);
  }
});

test("Stripe: any one of several v1 signatures may match (secret rotation)", () => {
  const h = headers({ "stripe-signature": `t=1700000000,v1=${"0".repeat(64)},v1=${STRIPE_SIG}` });
  assert.deepEqual(stripe.verifyWebhook(STRIPE_BODY, h, STRIPE_SECRET, 1700000010), { ok: true });
});

const razorpayCaptured = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    entity: "event",
    event: "payment.captured",
    created_at: 1767000000,
    payload: {
      payment: {
        entity: {
          id: "pay_123", amount: 49900, currency: "inr", status: "captured", order_id: "order_9", method: "upi",
          vpa: "ravi.kumar@oksbi", email: "ravi@example.com", contact: "+919876543210", customer_id: "cust_1",
          created_at: 1767000000, notes: { trackme_session: "sess-abc", trackme_user: "user-7" }, ...over,
        },
      },
    },
  });

test("Razorpay: a captured payment is normalised, with money in minor units and no personal data", () => {
  const [event, ...rest] = razorpay.normalize(razorpayCaptured(), "evt_rzp_1");
  assert.equal(rest.length, 0);
  assert.deepEqual(event, {
    gateway: "razorpay", gatewayEventId: "evt_rzp_1", paymentId: "pay_123", orderId: "order_9", status: "captured",
    amountMinor: 49900, currency: "INR", method: "upi", failureCodeRaw: "", bank: "oksbi", customerRef: "cust_1",
    createdAt: new Date(1767000000 * 1000).toISOString(), sessionRef: "sess-abc", userRef: "user-7",
  });
  const serialized = JSON.stringify(event);
  for (const secret of ["ravi.kumar", "ravi@example.com", "9876543210"]) assert.ok(!serialized.includes(secret), `${secret} must not be kept`);
});

test("Razorpay: a failed payment keeps the failure codes but not the free-text description", () => {
  const [event] = razorpay.normalize(
    razorpayCaptured({ status: "failed", error_source: "customer", error_step: "payment_authentication", error_reason: "payment_failed", error_code: "BAD_REQUEST_ERROR", error_description: "Ravi's card 4242424242424242 was declined" })
      .replace("payment.captured", "payment.failed"),
    "e2"
  );
  assert.equal(event!.status, "failed");
  assert.equal(event!.failureCodeRaw, "customer:payment_authentication:payment_failed:BAD_REQUEST_ERROR");
  assert.ok(!JSON.stringify(event).includes("4242"));
});

test("Razorpay: amounts that are not whole non-negative numbers drop the event instead of storing nonsense", () => {
  for (const amount of [12.5, "499", -1, null, 1e20]) assert.deepEqual(razorpay.normalize(razorpayCaptured({ amount }), "e"), [], String(amount));
  assert.deepEqual(razorpay.normalize("not json", "e"), []);
  assert.deepEqual(razorpay.normalize("{}", "e"), []);
});

test("Razorpay: refunds count once (processed), disputes when raised, and order.paid or other notifications are ignored", () => {
  const refund = (event: string) => JSON.stringify({ event, created_at: 1767000100, payload: { refund: { entity: { id: "rfnd_1", amount: 10000, currency: "INR", payment_id: "pay_123", created_at: 1767000100 } } } });
  assert.equal(razorpay.normalize(refund("refund.created"), "e").length, 0, "created and processed would double count");
  const [processed] = razorpay.normalize(refund("refund.processed"), "e");
  assert.deepEqual([processed!.status, processed!.amountMinor, processed!.paymentId], ["refunded", 10000, "pay_123"]);
  const dispute = JSON.stringify({ event: "payment.dispute.created", payload: { dispute: { entity: { id: "disp_1", payment_id: "pay_123", amount: 49900, currency: "INR" } } } });
  assert.equal(razorpay.normalize(dispute, "e")[0]!.status, "disputed");
  assert.deepEqual(razorpay.normalize(JSON.stringify({ event: "order.paid", payload: {} }), "e"), []);
});

test("Razorpay: the event id comes from the header, or a hash of the body when absent", () => {
  assert.equal(razorpay.eventId("{}", headers({ "x-razorpay-event-id": "evt_abc" })), "evt_abc");
  const a = razorpay.eventId("{}", headers({}));
  assert.match(a, /^body_[0-9a-f]{40}$/);
  assert.equal(a, razorpay.eventId("{}", headers({})));
  assert.notEqual(a, razorpay.eventId('{"x":1}', headers({})));
});

const stripeEvent = (type: string, object: Record<string, unknown>) => JSON.stringify({ id: "evt_s1", type, created: 1767000000, data: { object } });

test("Stripe: intents map to created, authorized, captured and failed; failures carry code and decline code", () => {
  const base = { id: "pi_1", amount: 2500, currency: "usd", customer: "cus_1", payment_method_types: ["card"], metadata: { order_id: "order_5", trackme_session: "s1", trackme_user: "u1" } };
  assert.equal(stripe.normalize(stripeEvent("payment_intent.succeeded", base), "evt_s1")[0]!.status, "captured");
  assert.equal(stripe.normalize(stripeEvent("payment_intent.created", base), "e")[0]!.status, "created");
  assert.equal(stripe.normalize(stripeEvent("payment_intent.amount_capturable_updated", base), "e")[0]!.status, "authorized");
  const [captured] = stripe.normalize(stripeEvent("payment_intent.succeeded", base), "evt_s1");
  assert.deepEqual([captured!.orderId, captured!.currency, captured!.method, captured!.amountMinor, captured!.sessionRef, captured!.customerRef], ["order_5", "USD", "card", 2500, "s1", "cus_1"]);

  const [failed] = stripe.normalize(
    stripeEvent("payment_intent.payment_failed", { ...base, last_payment_error: { code: "card_declined", decline_code: "insufficient_funds", message: "Your card ending 4242 was declined", payment_method: { type: "card" } } }),
    "e"
  );
  assert.equal(failed!.failureCodeRaw, "card_declined:insufficient_funds");
  assert.ok(!JSON.stringify(failed).includes("4242"));
});

test("Stripe: each refund is its own event (not the running total), disputes are recorded, other events are ignored", () => {
  const [refund] = stripe.normalize(stripeEvent("refund.created", { id: "re_1", amount: 700, currency: "usd", payment_intent: "pi_1" }), "e");
  assert.deepEqual([refund!.status, refund!.amountMinor, refund!.paymentId], ["refunded", 700, "pi_1"]);
  assert.equal(stripe.normalize(stripeEvent("charge.refunded", { amount_refunded: 700, payment_intent: "pi_1" }), "e").length, 0);
  assert.equal(stripe.normalize(stripeEvent("charge.dispute.created", { id: "dp_1", amount: 2500, currency: "usd", payment_intent: "pi_1" }), "e")[0]!.status, "disputed");
  assert.deepEqual(stripe.normalize(stripeEvent("customer.created", { id: "cus_1" }), "e"), []);
});

test("Stripe: a method is only reported when the intent names exactly one", () => {
  const base = { id: "pi_1", amount: 100, currency: "usd" };
  assert.equal(stripe.normalize(stripeEvent("payment_intent.succeeded", { ...base, payment_method_types: ["card", "upi"] }), "e")[0]!.method, "other");
  assert.equal(stripe.normalize(stripeEvent("payment_intent.succeeded", { ...base, payment_method_types: ["upi"] }), "e")[0]!.method, "upi");
});

test("the gateway registry knows only the supported gateways", () => {
  assert.equal(getGateway("razorpay"), razorpay);
  assert.equal(getGateway("stripe"), stripe);
  for (const bad of ["paypal", "", "__proto__", "constructor"]) assert.equal(getGateway(bad), null, bad);
});
