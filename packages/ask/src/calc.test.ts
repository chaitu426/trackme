import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatResult } from "./calc.js";
import { classifyFailure, AskFailure } from "./failure.js";

test("evaluate does arithmetic with precedence, parentheses, unary minus and thousands separators", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("-4 + 10"), 6);
  assert.equal(evaluate("2 ^ 3 ^ 2"), 512);
  assert.equal(evaluate("1,280 - 1,010"), 270);
  assert.equal(formatResult(evaluate("(1280 - 1010) / 1010 * 100")), "26.7327");
});

test("evaluate refuses anything that is not arithmetic", () => {
  for (const bad of ["process.exit(1)", "1; 2", "a + 1", "1 / 0", "(1", "1 +", "", "9".repeat(250)]) {
    assert.throws(() => evaluate(bad), undefined, bad.slice(0, 20));
  }
});

test("classifyFailure names the cause so the person is not told 'could not finish' for something we know", () => {
  assert.equal(classifyFailure({ status: 429 }).code, "busy_provider");
  assert.equal(classifyFailure({ status: 401 }).code, "provider_auth");
  assert.equal(classifyFailure({ status: 503 }).code, "provider");
  assert.equal(classifyFailure(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" })).code, "timeout");
  assert.equal(classifyFailure(new Error("boom")).code, "unknown");
  const own = new AskFailure("steps", "x");
  assert.equal(classifyFailure(own), own);
});
