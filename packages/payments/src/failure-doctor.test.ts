import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSignals, CATEGORY_GUIDE, classifyFailure, DEFAULT_RULES, FAILURE_CATEGORIES, parseRules, rulesVersion, type FailureContext } from "./failure-doctor.js";

const calm: FailureContext = { gateway: "razorpay", method: "card", sameSessionErrors: 0, gatewaySuccessRate: 0.93, gatewayVolume: 100, secondsToFail: 20 };
const classify = (code: string, over: Partial<FailureContext> = {}, method = over.method ?? "card", gateway = over.gateway ?? "razorpay") =>
  classifyFailure({ gateway, method, code, context: { ...calm, ...over, method, gateway } });

test("the codes the adapters actually produce land in the right category", () => {
  assert.equal(classify("bank:payment_authorization:insufficient_funds:BAD_REQUEST_ERROR").category, "insufficient_funds");
  assert.equal(classify("bank:payment_authorization:card_declined:BAD_REQUEST_ERROR").category, "bank_decline");
  assert.equal(classify("customer:payment_authentication:otp_incorrect:BAD_REQUEST_ERROR").category, "auth_failed");
  assert.equal(classify("customer:payment_authentication:3ds_challenge_failed:BAD_REQUEST_ERROR").category, "auth_failed");
  assert.equal(classify("customer:payment_authentication:wrong_pin:BAD_REQUEST_ERROR", {}, "upi").category, "auth_failed");
  assert.equal(classify("customer:collect_request:expired:BAD_REQUEST_ERROR", {}, "upi").category, "upi_pending_expired");
  assert.equal(classify("gateway:payment_processing:gateway_timeout:GATEWAY_ERROR").category, "gateway_outage");
  assert.equal(classify("customer:payment_authentication:abandoned:BAD_REQUEST_ERROR").category, "user_abandon");
  assert.equal(classify("card_declined:insufficient_funds", {}, "card", "stripe").category, "insufficient_funds");
  assert.equal(classify("card_declined:generic_decline", {}, "card", "stripe").category, "bank_decline");
  assert.equal(classify("authentication_required", {}, "card", "stripe").category, "auth_failed");
});

test("the specific rule wins over the general one", () => {
  // A UPI limit is the bank's refusal, not an expired request, even though both mention upi.
  assert.equal(classify("bank:payment_authorization:upi_limit_exceeded:BAD_REQUEST_ERROR", {}, "upi").category, "bank_decline");
  // "insufficient_funds" inside a card_declined code is about funds, not a generic decline.
  assert.equal(classify("card_declined:insufficient_funds", {}, "card", "stripe").ruleId, "funds-1");
});

test("a gateway timeout on a UPI payment is the gateway, not the UPI app", () => {
  assert.equal(classify("gateway:payment_processing:gateway_timeout:GATEWAY_ERROR", {}, "upi").category, "gateway_outage");
  assert.equal(classify("customer:upi:timed_out:BAD_REQUEST_ERROR", {}, "upi").category, "upi_timeout");
});

test("a rule limited to a method does not fire for another", () => {
  assert.notEqual(classify("customer:collect_request:expired:BAD_REQUEST_ERROR", {}, "card").category, "upi_pending_expired");
});

test("the gateway's own code is trusted before the context", () => {
  const during = { sameSessionErrors: 2, gatewaySuccessRate: 0.2 };
  assert.equal(classify("bank:payment_authorization:card_declined:BAD_REQUEST_ERROR", during).category, "bank_decline");
});

test("with an unhelpful code, the context decides", () => {
  assert.deepEqual(classify("weird_code", { gatewaySuccessRate: 0.2, gatewayVolume: 40 }), { category: "gateway_outage", ruleId: "ctx-gateway" });
  assert.deepEqual(classify("weird_code", { sameSessionErrors: 1 }), { category: "app_bug", ruleId: "ctx-app" });
  assert.deepEqual(classify("weird_code", { secondsToFail: 240 }), { category: "network_error", ruleId: "ctx-slow" });
});

test("a low gateway rate is ignored when there is too little traffic behind it", () => {
  assert.equal(classify("weird_code", { gatewaySuccessRate: 0.1, gatewayVolume: 3 }).category, "unknown");
  assert.equal(classify("weird_code", { gatewaySuccessRate: null, gatewayVolume: 0 }).category, "unknown");
});

test("nothing matching is unknown, with no rule id", () => {
  assert.deepEqual(classify(""), { category: "unknown", ruleId: "none" });
  assert.deepEqual(classify("zzz"), { category: "unknown", ruleId: "none" });
});

test("matching ignores case", () => {
  assert.equal(classify("BANK:PAYMENT_AUTHORIZATION:INSUFFICIENT_FUNDS").category, "insufficient_funds");
});

test("every category has a guide entry and every seed rule uses a real category and a unique id", () => {
  for (const c of FAILURE_CATEGORIES) assert.ok(CATEGORY_GUIDE[c].label && CATEGORY_GUIDE[c].action, c);
  assert.equal(new Set(DEFAULT_RULES.map((r) => r.id)).size, DEFAULT_RULES.length);
  assert.ok(DEFAULT_RULES.every((r) => (FAILURE_CATEGORIES as readonly string[]).includes(r.category)));
  assert.equal(parseRules(JSON.parse(JSON.stringify(DEFAULT_RULES))).ok, true);
});

test("a bad rule table is refused with reasons instead of being half applied", () => {
  const bad = parseRules([{ id: "a", category: "nonsense", codeIncludes: ["x"] }, { id: "a", category: "bank_decline" }, { id: "b", category: "bank_decline", signals: ["moon"] }]);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.some((e) => e.includes("unknown category")));
    assert.ok(bad.errors.some((e) => e.includes("duplicate id")));
    assert.ok(bad.errors.some((e) => e.includes("needs codeIncludes or signals")));
    assert.ok(bad.errors.some((e) => e.includes("signals must be")));
  }
  assert.equal(parseRules("nope").ok, false);
});

test("a custom table replaces the seed", () => {
  const parsed = parseRules([{ id: "mine", category: "fraud_block", codeIncludes: ["Velocity"] }]);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(classifyFailure({ gateway: "stripe", method: "card", code: "velocity_check", context: calm }, parsed.rules).category, "fraud_block");
});

test("the rule version changes when the rules do", () => {
  const a = rulesVersion(DEFAULT_RULES);
  assert.equal(a, rulesVersion(DEFAULT_RULES));
  assert.notEqual(a, rulesVersion([...DEFAULT_RULES, { id: "x", category: "unknown", codeIncludes: ["x"] }]));
});

test("signals are reported for display", () => {
  assert.deepEqual(activeSignals({ ...calm, sameSessionErrors: 1, secondsToFail: 300 }), ["session_error", "slow_failure"]);
  assert.deepEqual(activeSignals(calm), []);
});
