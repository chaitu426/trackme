import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_CARDS,
  assertDemoAllowed,
  cardOutcome,
  completionEvents,
  createDemoGateway,
  demoAllowed,
  demoSecret,
  parseEvents,
  serializeEvents,
  signPayload,
  signSession,
  verifySession,
  verifySignature,
} from "./demo.js";
import { WebhookSignatureError } from "./gateway.js";
import { planFor, reduce } from "./state.js";
import { priceFor } from "./types.js";

const SECRET = "a-test-secret-of-sufficient-length";
const NOW = new Date("2026-03-01T12:00:00Z");
const C = "22222222-2222-2222-2222-222222222222";

test("the demo gateway refuses to run in production unless asked to", () => {
  assert.throws(() => assertDemoAllowed({ NODE_ENV: "production" }), /disabled in production/);
  assert.throws(() => assertDemoAllowed({ NODE_ENV: "production", BILLING_ALLOW_DEMO: "false" }));
  assertDemoAllowed({ NODE_ENV: "production", BILLING_ALLOW_DEMO: "true" });
  assertDemoAllowed({ NODE_ENV: "development" });
});

test("demoAllowed is the non-throwing form of the same rule", () => {
  assert.equal(demoAllowed({ NODE_ENV: "production" }), false);
  assert.equal(demoAllowed({ NODE_ENV: "production", BILLING_ALLOW_DEMO: "true" }), true);
  assert.equal(demoAllowed({ NODE_ENV: "development" }), true);
});

test("in production the demo needs a real secret; elsewhere a dev default is used", () => {
  assert.throws(() => demoSecret({ NODE_ENV: "production" }), /BILLING_DEMO_SECRET/);
  assert.throws(() => demoSecret({ NODE_ENV: "production", BILLING_DEMO_SECRET: "short" }));
  assert.equal(demoSecret({ NODE_ENV: "production", BILLING_DEMO_SECRET: SECRET }), SECRET);
  assert.ok(demoSecret({ NODE_ENV: "development" }).length >= 16);
});

test("a signed payload verifies; a tampered body, wrong secret or stale timestamp does not", () => {
  const body = '{"a":1}';
  const t = Math.floor(NOW.getTime() / 1000);
  const header = signPayload(SECRET, body, t);
  assert.equal(verifySignature(SECRET, body, header, NOW), true);
  assert.equal(verifySignature(SECRET, '{"a":2}', header, NOW), false);
  assert.equal(verifySignature("another-secret-of-sufficient-length", body, header, NOW), false);
  assert.equal(verifySignature(SECRET, body, header, new Date(NOW.getTime() + 6 * 60 * 1000)), false);
  assert.equal(verifySignature(SECRET, body, undefined, NOW), false);
  assert.equal(verifySignature(SECRET, body, "garbage", NOW), false);
});

test("a checkout session round-trips, expires, and cannot be altered", () => {
  const session = { companyId: C, interval: "year" as const, email: "a@b.co", successUrl: "/ok", cancelUrl: "/no", expiresAt: NOW.getTime() + 1000 };
  const token = signSession(SECRET, session);
  assert.deepEqual(verifySession(SECRET, token, NOW), session);
  assert.equal(verifySession(SECRET, token, new Date(NOW.getTime() + 2000)), null);
  assert.equal(verifySession("another-secret-of-sufficient-length", token, NOW), null);
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...session, companyId: "someone-else" })).toString("base64url");
  assert.equal(verifySession(SECRET, `${forged}.${mac}`, NOW), null);
  assert.notEqual(forged, body);
  assert.equal(verifySession(SECRET, "nonsense", NOW), null);
});

test("each test card has the outcome it advertises; anything else is unknown", () => {
  for (const card of DEMO_CARDS) assert.equal(cardOutcome(card.number), card.outcome);
  assert.equal(cardOutcome("4242424242424242"), "success");
  assert.equal(cardOutcome("4000-0000-0000-0002"), "declined");
  assert.equal(cardOutcome("1234 5678 9012 3456"), "unknown");
});

test("a successful checkout produces events that make the company Pro and bill the plan's price", () => {
  const events = completionEvents({ companyId: C, interval: "year", email: null, successUrl: "/", cancelUrl: "/", expiresAt: 0 }, NOW);
  assert.deepEqual(events.map((e) => e.type), ["checkout.completed", "invoice.paid"]);
  let sub = null as ReturnType<typeof reduce>["sub"];
  for (const e of events) sub = reduce(sub, e, NOW).sub;
  assert.equal(planFor(sub, NOW), "pro");
  const invoice = events[1]!;
  assert.equal(invoice.type === "invoice.paid" && invoice.amountMinor, priceFor("year").amountMinor);
  assert.equal(new Set(events.map((e) => e.id)).size, 2);
});

test("events survive the wire: dates come back as dates, junk is dropped", () => {
  const events = completionEvents({ companyId: C, interval: "month", email: null, successUrl: "/", cancelUrl: "/", expiresAt: 0 }, NOW);
  const back = parseEvents(serializeEvents(events));
  assert.equal(back.length, 2);
  assert.ok(back[0]!.occurredAt instanceof Date);
  assert.equal(back[0]!.occurredAt.getTime(), NOW.getTime());
  assert.deepEqual(parseEvents("not json"), []);
  assert.deepEqual(parseEvents('{"events":[{"id":1}]}'), []);
  assert.deepEqual(parseEvents('{"events":[{"id":"x","companyId":"c","type":"invoice.paid","occurredAt":"nope"}]}'), []);
});

test("the gateway delivers signed events, and its own webhook parser accepts them but rejects forgeries", async () => {
  const delivered: { body: string; signature: string }[] = [];
  const gateway = createDemoGateway({
    secret: SECRET,
    appOrigin: "https://app.example.com/",
    now: () => NOW,
    deliver: async (body, signature) => {
      delivered.push({ body, signature });
    },
  });

  await gateway.cancelAtPeriodEnd({ companyId: C, providerSubscriptionId: null });
  assert.equal(delivered.length, 1);
  const parsed = gateway.verifyAndParseWebhook(delivered[0]!.body, { "x-demo-signature": delivered[0]!.signature });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.type, "subscription.updated");
  assert.equal(parsed[0]!.type === "subscription.updated" && parsed[0]!.cancelAtPeriodEnd, true);

  assert.throws(() => gateway.verifyAndParseWebhook(delivered[0]!.body, { "x-demo-signature": "t=1,v1=00" }), WebhookSignatureError);
  assert.throws(() => gateway.verifyAndParseWebhook(delivered[0]!.body, {}), WebhookSignatureError);
  assert.throws(() => gateway.verifyAndParseWebhook(delivered[0]!.body.replace("true", "false"), { "x-demo-signature": delivered[0]!.signature }), WebhookSignatureError);

  await gateway.resume({ companyId: C, providerSubscriptionId: "sub_x" });
  await gateway.changeInterval({ companyId: C, providerSubscriptionId: "sub_x", interval: "year" });
  assert.equal(delivered.length, 3);
});

test("checkout returns a hosted page URL carrying a verifiable session", async () => {
  const gateway = createDemoGateway({ secret: SECRET, appOrigin: "https://app.example.com/", now: () => NOW, deliver: async () => {} });
  const { url } = await gateway.createCheckout({ companyId: C, plan: "pro", interval: "month", email: "a@b.co", successUrl: "/ok", cancelUrl: "/no" });
  assert.ok(url.startsWith("https://app.example.com/billing/demo/checkout?session="));
  const token = decodeURIComponent(url.split("session=")[1]!);
  assert.equal(verifySession(SECRET, token, NOW)?.companyId, C);
});

test("prices are configuration: placeholders by default, overridable, yearly is two months free", () => {
  assert.deepEqual(priceFor("month", {}), { amountMinor: 2900, currency: "USD" });
  assert.deepEqual(priceFor("year", {}), { amountMinor: 29000, currency: "USD" });
  assert.deepEqual(priceFor("month", { BILLING_PRO_MONTHLY_MINOR: "1500", BILLING_CURRENCY: "INR" }), { amountMinor: 1500, currency: "INR" });
  assert.deepEqual(priceFor("year", { BILLING_PRO_MONTHLY_MINOR: "1500", BILLING_PRO_YEARLY_MINOR: "15000" }), { amountMinor: 15000, currency: "USD" });
});
