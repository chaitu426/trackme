import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@trackme/contracts";
import { assertChannelType, assertFeature, planLimitError, seatFor } from "./plan";

test("owner, admin and member share the member seats; only viewers use the viewer seats", () => {
  assert.equal(seatFor("owner"), "members");
  assert.equal(seatFor("admin"), "members");
  assert.equal(seatFor("member"), "members");
  assert.equal(seatFor("viewer"), "viewers");
});

test("a plan-limit error is a 402 that says what was hit and what to upgrade to", () => {
  const e = planLimitError("free", "sites", 1);
  assert.ok(e instanceof AppError);
  assert.equal(e.status, 402);
  assert.equal(e.code, "PLAN_LIMIT");
  assert.deepEqual(e.plan, { plan: "free", resource: "sites", limit: 1, current: 1, upgradeTo: "pro" });
  assert.match(e.detail, /free plan allows 1 websites/);
  assert.equal(e.toProblemDetails().plan?.upgradeTo, "pro");

  const top = planLimitError("pro", "apiKeys", 10);
  assert.equal(top.plan?.upgradeTo, null);
  assert.doesNotMatch(top.detail, /Upgrade to/);
});

test("features missing from the free plan are refused, and pro has them", () => {
  for (const feature of ["teams", "paymentsAnalytics", "publicDashboard", "auditLog", "fullExports"] as const) {
    assert.throws(() => assertFeature("free", feature), (e) => e instanceof AppError && e.status === 402 && e.code === "PLAN_FEATURE");
    assertFeature("pro", feature);
  }
});

test("free may only create email channels; pro may create any", () => {
  assertChannelType("free", "email");
  for (const type of ["slack", "discord", "webhook"]) {
    assert.throws(() => assertChannelType("free", type), (e) => e instanceof AppError && e.status === 402);
    assertChannelType("pro", type);
  }
});

test("an unknown plan name gets the free allowances", () => {
  assert.throws(() => assertFeature("starter", "teams"));
  assert.throws(() => assertChannelType("enterprise", "slack"));
});
