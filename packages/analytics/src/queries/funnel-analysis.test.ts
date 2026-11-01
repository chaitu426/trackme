import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalyticsRangeTooWideError } from "../errors.js";
import {
  FUNNEL_MAX_RANGE_DAYS,
  assertFunnelRange,
  buildFunnelAnalysisQuery,
  stepCondition,
  type FunnelStepDefinition,
} from "./funnel-analysis.js";

const steps: FunnelStepDefinition[] = [
  { order: 1, name: "Landing", type: "pageview", target: "/" },
  { order: 2, name: "Signup", type: "custom_event", target: "account_created" },
];

test("pageview steps use startsWith so % and _ in paths are literal", () => {
  assert.equal(
    stepCondition(0, "pageview"),
    "(type = 'pageview' AND startsWith(path, {step_0_target:String}))"
  );
  assert.equal(stepCondition(0, "pageview").includes("LIKE"), false);
});

test("funnel SQL pre-filters to step-matching events and enables in-order aggregation", () => {
  const { query, params } = buildFunnelAnalysisQuery(steps, 86400);
  assert.ok(query.includes("startsWith(path, {step_0_target:String})"));
  assert.ok(query.includes("AND ("));
  assert.ok(query.includes("SETTINGS optimize_aggregation_in_order = 1"));
  assert.equal(query.includes("LIKE concat"), false);
  assert.equal(params.windowSeconds, 86400);
  assert.equal(params.step_0_target, "/");
  assert.equal(params.step_1_target, "account_created");
});

test("ranges longer than 31 days are rejected before querying", () => {
  assert.doesNotThrow(() =>
    assertFunnelRange("2026-09-10T00:00:00.000Z", "2026-10-11T00:00:00.000Z", FUNNEL_MAX_RANGE_DAYS)
  );
  assert.throws(
    () => assertFunnelRange("2026-09-01T00:00:00.000Z", "2026-10-11T00:00:00.000Z"),
    AnalyticsRangeTooWideError
  );
});
