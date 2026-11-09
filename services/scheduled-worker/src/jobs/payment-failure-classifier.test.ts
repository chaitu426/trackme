import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPending, type ClassifiedRow, type ClassifierDeps, type ErrorHit, type Outcome, type PendingFailure } from "./payment-failure-classifier.js";

const T = Date.UTC(2026, 10, 9, 12, 0, 0);
const failure = (over: Partial<PendingFailure> = {}): PendingFailure => ({
  workspaceId: "w1", siteId: "s1", paymentId: "pay_1", orderId: "order_1", gateway: "razorpay", method: "card", amountMinor: 50_000, currency: "INR",
  code: "bank:payment_authorization:card_declined:BAD_REQUEST_ERROR", userRef: "", failedAtMs: T, startedAtMs: T - 20_000, ...over,
});

function deps(pending: PendingFailure[], extra: { sessions?: Record<string, string>; errors?: ErrorHit[]; outcomes?: Outcome[] } = {}) {
  const saved: ClassifiedRow[] = [];
  const calls = { errors: 0, outcomes: 0 };
  const d: ClassifierDeps = {
    fetchPending: async () => pending,
    fetchSessions: async () => new Map(Object.entries(extra.sessions ?? {})),
    fetchErrors: async () => (calls.errors++, extra.errors ?? []),
    fetchOutcomes: async () => (calls.outcomes++, extra.outcomes ?? []),
    save: async (rows) => void saved.push(...rows),
  };
  return { d, saved, calls };
}

test("a clear code is classified and stored with the rule that decided it", async () => {
  const { d, saved } = deps([failure()]);
  assert.equal(await classifyPending(d), 1);
  assert.equal(saved[0]!.category, "bank_decline");
  assert.equal(saved[0]!.ruleId, "bank-1");
  assert.equal(saved[0]!.paymentId, "pay_1");
  assert.ok(saved[0]!.rulesVersion.startsWith("r"));
});

test("nothing pending does nothing and asks for nothing", async () => {
  const { d, saved, calls } = deps([]);
  assert.equal(await classifyPending(d), 0);
  assert.equal(saved.length, 0);
  assert.equal(calls.errors + calls.outcomes, 0);
});

test("an error in the same session just before the failure is recorded, and decides an unhelpful code", async () => {
  const { d, saved } = deps([failure({ code: "weird" })], {
    sessions: { "s1:order_1": "777" },
    errors: [{ siteId: "s1", sessionHash: "777", atMs: T - 30_000 }],
  });
  await classifyPending(d);
  assert.equal(saved[0]!.sessionError, true);
  assert.equal(saved[0]!.category, "app_bug");
});

test("an error long before, or in another session, is not counted", async () => {
  const { d, saved } = deps([failure({ code: "weird" })], {
    sessions: { "s1:order_1": "777" },
    errors: [{ siteId: "s1", sessionHash: "777", atMs: T - 10 * 60_000 }, { siteId: "s1", sessionHash: "888", atMs: T - 5_000 }],
  });
  await classifyPending(d);
  assert.equal(saved[0]!.sessionError, false);
  assert.equal(saved[0]!.category, "unknown");
});

test("a failure during a gateway slump is a gateway problem when the code says nothing", async () => {
  const outcomes: Outcome[] = Array.from({ length: 12 }, (_, i) => ({ siteId: "s1", gateway: "razorpay", atMs: T - i * 20_000, paid: i < 2 }));
  const { d, saved } = deps([failure({ code: "weird" })], { outcomes });
  await classifyPending(d);
  assert.equal(saved[0]!.category, "gateway_outage");
  assert.equal(saved[0]!.ruleId, "ctx-gateway");
  assert.equal(saved[0]!.gatewayVolume, 12);
  assert.ok(Math.abs(saved[0]!.gatewayRate - 2 / 12) < 1e-9);
});

test("another gateway's or another site's outcomes are not mixed in", async () => {
  const outcomes: Outcome[] = Array.from({ length: 12 }, () => ({ siteId: "s2", gateway: "razorpay", atMs: T, paid: false }));
  const { d, saved } = deps([failure({ code: "weird" })], { outcomes });
  await classifyPending(d);
  assert.equal(saved[0]!.gatewayVolume, 0);
  assert.equal(saved[0]!.category, "unknown");
});

test("a long wait before failing is a network error when the code says nothing, and the unknown start is stored as -1", async () => {
  const slow = deps([failure({ code: "weird", startedAtMs: T - 300_000 })]);
  await classifyPending(slow.d);
  assert.equal(slow.saved[0]!.category, "network_error");
  const unseen = deps([failure({ code: "weird", startedAtMs: null })]);
  await classifyPending(unseen.d);
  assert.equal(unseen.saved[0]!.secondsToFail, -1);
});

test("a whole batch is classified in one save", async () => {
  const batch = [failure(), failure({ paymentId: "pay_2", code: "bank:x:insufficient_funds" }), failure({ paymentId: "pay_3", code: "customer:x:abandoned" })];
  const { d, saved } = deps(batch);
  assert.equal(await classifyPending(d), 3);
  assert.deepEqual(saved.map((r) => r.category), ["bank_decline", "insufficient_funds", "user_abandon"]);
});

test("classified failures are handed to the emit hook after they are saved, and a failing hook does not undo the job", async () => {
  const order: string[] = [];
  const base = deps([failure()]);
  const d: ClassifierDeps = { ...base.d, save: async (rows) => void (order.push("save"), base.saved.push(...rows)), emit: async () => { order.push("emit"); throw new Error("mailer down"); } };
  assert.equal(await classifyPending(d), 1);
  assert.deepEqual(order, ["save", "emit"]);
  assert.equal(base.saved.length, 1);
});
