import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, canAdd, eventQuotaFor, limitOf, limitsFor, upgradeTarget } from "./plans.js";

test("the plans match the published table", () => {
  const f = PLANS.free;
  assert.deepEqual([f.workspaces, f.sites, f.eventsPerMonth, f.members, f.viewers], [1, 1, 50_000, 2, 2]);
  assert.deepEqual([f.funnels, f.goals, f.segments, f.apiKeys, f.alertRules, f.askPerMonth], [1, 3, 1, 1, 1, 20]);
  assert.equal(f.teams, false);
  assert.equal(f.retentionMonths, 6);
  assert.deepEqual(f.alertChannelTypes, ["email"]);
  const p = PLANS.pro;
  assert.deepEqual([p.workspaces, p.sites, p.eventsPerMonth, p.members, p.viewers], [3, 10, 1_000_000, 10, null]);
  assert.deepEqual([p.funnels, p.goals, p.segments, p.apiKeys, p.askPerMonth], [null, null, null, 10, 500]);
  assert.equal(p.teams && p.paymentsAnalytics && p.publicDashboard && p.auditLog && p.fullExports, true);
  assert.equal(p.retentionMonths, 24);
});

test("an unknown plan is treated as free, never as unlimited", () => {
  assert.equal(limitsFor("starter"), PLANS.free);
  assert.equal(limitsFor(""), PLANS.free);
});

test("the edge quota is a hard cap on free and carries a 20% margin on pro", () => {
  assert.equal(eventQuotaFor("free"), 50_000);
  assert.equal(eventQuotaFor("pro"), 1_200_000);
});

test("canAdd allows one more only below the cap, and always when unlimited", () => {
  assert.equal(canAdd("free", "sites", 0), true);
  assert.equal(canAdd("free", "sites", 1), false);
  assert.equal(canAdd("pro", "viewers", 10_000), true);
  assert.equal(canAdd("pro", "apiKeys", 9), true);
  assert.equal(canAdd("pro", "apiKeys", 10), false);
  assert.equal(limitOf("free", "askRuns"), 20);
});

test("free suggests pro, and pro has nothing above it", () => {
  assert.equal(upgradeTarget("free"), "pro");
  assert.equal(upgradeTarget("pro"), null);
});
