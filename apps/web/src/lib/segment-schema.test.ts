import assert from "node:assert/strict";
import test from "node:test";
import {
  SegmentDefinitionSchema,
  describeBehavior,
  describeCondition,
  isCompleteCondition,
} from "./segment-schema";

test("a typical segment validates: pro plan, active this week, never reached checkout", () => {
  const parsed = SegmentDefinitionSchema.safeParse({
    match: "all",
    conditions: [
      { field: "trait", key: "plan", op: "eq", value: "pro" },
      { field: "lastSeen", op: "within", days: 7 },
    ],
    behavior: [{ op: "did_not", kind: "pageview", target: "/checkout", days: 90 }],
  });
  assert.equal(parsed.success, true);
});

test("unknown fields, bad operators and out-of-range numbers are rejected", () => {
  const base = { match: "all", behavior: [] };
  assert.equal(SegmentDefinitionSchema.safeParse({ ...base, conditions: [{ field: "password", op: "eq" }] }).success, false);
  assert.equal(SegmentDefinitionSchema.safeParse({ ...base, conditions: [{ field: "sessions", op: "between", value: 1 }] }).success, false);
  assert.equal(SegmentDefinitionSchema.safeParse({ ...base, conditions: [{ field: "lastSeen", op: "within", days: 0 }] }).success, false);
  assert.equal(SegmentDefinitionSchema.safeParse({ ...base, conditions: [{ field: "trait", key: "a;b'--", op: "eq", value: "x" }] }).success, false);
});

test("a definition cannot grow without bound", () => {
  const many = Array.from({ length: 11 }, () => ({ field: "sessions", op: "gte", value: 1 }));
  assert.equal(SegmentDefinitionSchema.safeParse({ match: "all", conditions: many, behavior: [] }).success, false);
});

test("a rule is complete only when it has what it needs to run", () => {
  assert.equal(isCompleteCondition({ field: "trait", key: "plan", op: "eq", value: "" }), false);
  assert.equal(isCompleteCondition({ field: "trait", key: "plan", op: "eq", value: "pro" }), true);
  assert.equal(isCompleteCondition({ field: "trait", key: "plan", op: "exists" }), true);
  assert.equal(isCompleteCondition({ field: "trait", key: "", op: "exists" }), false);
  assert.equal(isCompleteCondition({ field: "email", op: "contains" }), false);
  assert.equal(isCompleteCondition({ field: "lastSeen", op: "within", days: 7 }), true);
});

test("rules read back in plain language", () => {
  assert.equal(describeCondition({ field: "trait", key: "plan", op: "eq", value: "pro" }), "plan = pro");
  assert.equal(describeCondition({ field: "lastSeen", op: "within", days: 7 }), "active in the last 7d");
  assert.equal(describeCondition({ field: "lastSeen", op: "before", days: 30 }), "inactive for 30d+");
  assert.equal(describeBehavior({ op: "did_not", kind: "pageview", target: "/checkout", days: 90 }), "never visited /checkout in the last 90d");
});
