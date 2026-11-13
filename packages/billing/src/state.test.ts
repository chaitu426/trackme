import { test } from "node:test";
import assert from "node:assert/strict";
import { GRACE_DAYS, addDays, nextPeriodEnd, planFor, reduce, tick } from "./state.js";
import type { BillingEvent, SubState } from "./types.js";

const T0 = new Date("2026-01-10T00:00:00Z");
const C = "11111111-1111-1111-1111-111111111111";

const checkout = (over: Partial<Extract<BillingEvent, { type: "checkout.completed" }>> = {}): BillingEvent => ({
  type: "checkout.completed",
  id: "evt_1",
  companyId: C,
  occurredAt: T0,
  interval: "month",
  providerCustomerId: "cus_1",
  providerSubscriptionId: "sub_1",
  periodStart: T0,
  periodEnd: nextPeriodEnd(T0, "month"),
  trialEnd: null,
  ...over,
});
const paid = (at: Date, id = "evt_p"): BillingEvent => ({
  type: "invoice.paid",
  id,
  companyId: C,
  occurredAt: at,
  interval: "month",
  providerSubscriptionId: "sub_1",
  providerInvoiceId: `in_${id}`,
  amountMinor: 2900,
  currency: "USD",
  periodStart: at,
  periodEnd: nextPeriodEnd(at, "month"),
});
const failed = (at: Date, id = "evt_f"): BillingEvent => ({
  type: "invoice.payment_failed",
  id,
  companyId: C,
  occurredAt: at,
  providerSubscriptionId: "sub_1",
  providerInvoiceId: `in_${id}`,
  amountMinor: 2900,
  currency: "USD",
  reason: "card_declined",
});

const must = (s: SubState | null): SubState => {
  assert.ok(s, "expected a subscription");
  return s;
};

test("no subscription is the free plan", () => {
  assert.equal(planFor(null, T0), "free");
});

test("a paid checkout makes the company Pro", () => {
  const { sub, applied } = reduce(null, checkout(), T0);
  assert.equal(applied, true);
  assert.equal(must(sub).status, "active");
  assert.equal(planFor(sub, T0), "pro");
});

test("a checkout with a future trial end is a trial, and Pro until it ends", () => {
  const trialEnd = addDays(T0, 14);
  const { sub } = reduce(null, checkout({ trialEnd }), T0);
  assert.equal(must(sub).status, "trialing");
  assert.equal(planFor(sub, addDays(T0, 13)), "pro");
  assert.equal(planFor(sub, addDays(T0, 14)), "free");
});

test("a failed payment keeps Pro for the grace period, then drops to free", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const failAt = addDays(T0, 30);
  sub = must(reduce(sub, failed(failAt), failAt).sub);
  assert.equal(sub.status, "past_due");
  assert.equal(planFor(sub, addDays(failAt, GRACE_DAYS - 1)), "pro");
  assert.equal(planFor(sub, addDays(failAt, GRACE_DAYS)), "free");
});

test("provider retries while past due do not extend the grace period", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const first = addDays(T0, 30);
  sub = must(reduce(sub, failed(first, "f1"), first).sub);
  const grace = sub.graceEndsAt;
  const retry = addDays(first, 3);
  sub = must(reduce(sub, failed(retry, "f2"), retry).sub);
  assert.equal(sub.graceEndsAt?.getTime(), grace?.getTime());
});

test("paying an overdue invoice restores the subscription and clears the grace period", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const failAt = addDays(T0, 30);
  sub = must(reduce(sub, failed(failAt), failAt).sub);
  const payAt = addDays(failAt, 2);
  sub = must(reduce(sub, paid(payAt), payAt).sub);
  assert.equal(sub.status, "active");
  assert.equal(sub.graceEndsAt, null);
  assert.equal(planFor(sub, payAt), "pro");
});

test("an older event arriving late is ignored", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const later = addDays(T0, 30);
  sub = must(reduce(sub, paid(later), later).sub);
  const stale = reduce(sub, failed(addDays(T0, 5)), later);
  assert.equal(stale.applied, false);
  assert.equal(stale.sub, sub);
});

test("a payment that arrives before its checkout still creates the subscription", () => {
  const { sub, applied } = reduce(null, paid(T0), T0);
  assert.equal(applied, true);
  assert.equal(must(sub).status, "active");
  assert.equal(planFor(sub, T0), "pro");
});

test("a failure or an update with no subscription is ignored, never an error", () => {
  assert.equal(reduce(null, failed(T0), T0).applied, false);
  assert.equal(
    reduce(null, { type: "subscription.updated", id: "u", companyId: C, occurredAt: T0, providerSubscriptionId: "s", cancelAtPeriodEnd: true }, T0).applied,
    false
  );
});

test("cancelling at period end keeps Pro until the paid period ends, and resuming undoes it", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const at = addDays(T0, 1);
  sub = must(reduce(sub, { type: "subscription.updated", id: "u1", companyId: C, occurredAt: at, providerSubscriptionId: "s", cancelAtPeriodEnd: true }, at).sub);
  assert.equal(sub.cancelAtPeriodEnd, true);
  assert.equal(planFor(sub, addDays(T0, 20)), "pro");
  assert.equal(planFor(sub, nextPeriodEnd(T0, "month")), "free");

  const back = addDays(T0, 2);
  sub = must(reduce(sub, { type: "subscription.updated", id: "u2", companyId: C, occurredAt: back, providerSubscriptionId: "s", cancelAtPeriodEnd: false }, back).sub);
  assert.equal(sub.cancelAtPeriodEnd, false);
  assert.equal(planFor(sub, nextPeriodEnd(T0, "month")), "pro");
});

test("changing the interval takes effect on the subscription without ending it", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const at = addDays(T0, 3);
  sub = must(reduce(sub, { type: "subscription.updated", id: "u", companyId: C, occurredAt: at, providerSubscriptionId: "s", interval: "year" }, at).sub);
  assert.equal(sub.interval, "year");
  assert.equal(sub.status, "active");
});

test("a cancelled subscription is free, and later failures cannot revive it", () => {
  let sub = must(reduce(null, checkout(), T0).sub);
  const at = addDays(T0, 10);
  sub = must(reduce(sub, { type: "subscription.canceled", id: "c", companyId: C, occurredAt: at, providerSubscriptionId: "s" }, at).sub);
  assert.equal(planFor(sub, at), "free");
  assert.equal(reduce(sub, failed(addDays(at, 1)), addDays(at, 1)).applied, false);
});

test("tick ends an expired trial, an expired grace period, and a cancel-at-period-end", () => {
  const trial = must(reduce(null, checkout({ trialEnd: addDays(T0, 14) }), T0).sub);
  assert.equal(tick(trial, addDays(T0, 13)), trial);
  assert.equal(tick(trial, addDays(T0, 14)).status, "canceled");

  let sub = must(reduce(null, checkout(), T0).sub);
  const failAt = addDays(T0, 30);
  sub = must(reduce(sub, failed(failAt), failAt).sub);
  assert.equal(tick(sub, addDays(failAt, GRACE_DAYS - 1)), sub);
  assert.equal(tick(sub, addDays(failAt, GRACE_DAYS)).status, "canceled");

  let ending = must(reduce(null, checkout(), T0).sub);
  ending = must(reduce(ending, { type: "subscription.updated", id: "u", companyId: C, occurredAt: addDays(T0, 1), providerSubscriptionId: "s", cancelAtPeriodEnd: true }, addDays(T0, 1)).sub);
  assert.equal(tick(ending, addDays(T0, 29)), ending);
  assert.equal(tick(ending, nextPeriodEnd(T0, "month")).status, "canceled");
});

test("a healthy subscription is untouched by tick", () => {
  const sub = must(reduce(null, checkout(), T0).sub);
  assert.equal(tick(sub, addDays(T0, 400)), sub);
});

test("a year ends a year later and a month a month later", () => {
  assert.equal(nextPeriodEnd(new Date("2026-01-31T00:00:00Z"), "year").toISOString().slice(0, 10), "2027-01-31");
  assert.equal(nextPeriodEnd(new Date("2026-03-10T00:00:00Z"), "month").toISOString().slice(0, 10), "2026-04-10");
});
