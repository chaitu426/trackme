import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntil, describeStatus, formatPrice, yearlySavingPercent, type SubscriptionView } from "./billing-view";

const NOW = new Date("2026-06-10T00:00:00Z");
const sub = (over: Partial<SubscriptionView>): SubscriptionView => ({
  status: "active",
  interval: "month",
  trialEnd: null,
  currentPeriodEnd: "2026-07-10T00:00:00Z",
  cancelAtPeriodEnd: false,
  graceEndsAt: null,
  provider: "demo",
  ...over,
});

test("no subscription: free, or Pro included for companies that predate plans", () => {
  assert.equal(describeStatus("free", null, false, NOW).headline, "Free plan");
  const beta = describeStatus("pro", null, true, NOW);
  assert.match(beta.headline, /Pro, included during the beta/);
});

test("a trial counts its days and warns in the last three", () => {
  const early = describeStatus("pro", sub({ status: "trialing", trialEnd: "2026-06-20T00:00:00Z" }), false, NOW);
  assert.equal(early.headline, "Pro trial, 10 days left");
  assert.equal(early.tone, "info");
  const late = describeStatus("pro", sub({ status: "trialing", trialEnd: "2026-06-12T00:00:00Z" }), false, NOW);
  assert.equal(late.tone, "warning");
  assert.equal(describeStatus("pro", sub({ status: "trialing", trialEnd: "2026-06-11T00:00:00Z" }), false, NOW).headline, "Pro trial, 1 day left");
});

test("an active subscription says when it renews, or when it ends if cancelled", () => {
  const active = describeStatus("pro", sub({}), false, NOW);
  assert.equal(active.headline, "Pro");
  assert.match(active.detail, /Renews Jul 10, 2026, billed monthly/);
  assert.match(describeStatus("pro", sub({ interval: "year" }), false, NOW).detail, /billed yearly/);
  const ending = describeStatus("pro", sub({ cancelAtPeriodEnd: true }), false, NOW);
  assert.equal(ending.headline, "Pro until Jul 10, 2026");
  assert.equal(ending.tone, "warning");
});

test("a failed payment is a danger state that names the grace deadline", () => {
  const view = describeStatus("pro", sub({ status: "past_due", graceEndsAt: "2026-06-17T00:00:00Z" }), false, NOW);
  assert.equal(view.tone, "danger");
  assert.match(view.detail, /7 more days \(until Jun 17, 2026\)/);
});

test("an ended subscription is free again and says data is kept", () => {
  const view = describeStatus("free", sub({ status: "canceled" }), false, NOW);
  assert.equal(view.headline, "Free plan");
  assert.match(view.detail, /data is kept/);
});

test("days never go negative; prices and savings format sensibly", () => {
  assert.equal(daysUntil("2026-06-01T00:00:00Z", NOW), 0);
  assert.equal(daysUntil(null, NOW), 0);
  assert.equal(formatPrice(2900, "USD"), "$29");
  assert.equal(formatPrice(2950, "USD"), "$29.50");
  assert.equal(yearlySavingPercent(2900, 29000), 17);
  assert.equal(yearlySavingPercent(0, 100), 0);
});
