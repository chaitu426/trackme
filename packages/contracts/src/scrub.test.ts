import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubErrorPayload, scrubText, scrubUrl } from "./scrub.js";

test("emails, phone numbers and UPI ids are replaced", () => {
  assert.equal(scrubText("failed for ada@example.com"), "failed for [email]");
  assert.equal(scrubText("call +91 98765 43210 now"), "call [phone] now");
  assert.equal(scrubText("mobile 9876543210"), "mobile [phone]");
  assert.equal(scrubText("us (415) 555-0132"), "us [phone]");
  assert.equal(scrubText("pay to ravi.kumar@okhdfcbank"), "pay to [upi-id]");
});

test("credentials never survive: JWTs, bearer tokens, API keys, passwords", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  assert.equal(scrubText(`token ${jwt} rejected`), "token [jwt] rejected");
  assert.equal(scrubText("Authorization: Bearer abcdef1234567890xyz"), "Authorization: Bearer [token]");
  assert.equal(scrubText("Authorization: Basic dXNlcjpwYXNzd29yZA=="), "Authorization: Basic [token]");
  assert.equal(scrubText("key sk_live_abcdEFGH12345678 used"), "key [api-key] used");
  assert.equal(scrubText("AKIAIOSFODNN7EXAMPLE leaked"), "[api-key] leaked");
  assert.equal(scrubText("gip_live_abcdefgh12345678"), "[api-key]");
  assert.equal(scrubText('login {"password":"hunter2!"} failed'), 'login {"password":"[redacted]"} failed');
  assert.equal(scrubText("api_key=abc123def456&x=1"), "api_key=[redacted]&x=1");
});

test("card numbers are removed only when they pass the Luhn check", () => {
  assert.equal(scrubText("card 4242 4242 4242 4242 declined"), "card [card] declined");
  assert.equal(scrubText("card 4242-4242-4242-4242"), "card [card]");
  assert.equal(scrubText("order 1234567890123456"), "order 1234567890123456");
  // Digits glued on after a card must not hide it.
  assert.equal(scrubText("card=4242424242424242 500"), "card=[card] 500");
  assert.equal(scrubText("4242 4242 4242 4242 500"), "[card] 500");
  assert.equal(scrubText("pay 4242424242424242 and 5555555555554444"), "pay [card] and [card]");
  // A long unbroken number is an id, not a card.
  assert.equal(scrubText("id 4242424242424242424242"), "id 4242424242424242424242");
});

test("ordinary technical text is left alone", () => {
  for (const text of [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "version 1.2.3.4 at 2026-11-09T10:00:00.000Z",
    "GET /api/orders/123 500 120ms",
    "line 120 col 45 in app.js",
  ]) {
    assert.equal(scrubText(text), text);
  }
});

test("URLs keep utm and a few safe parameters, lose the rest, and lose credentials and fragments", () => {
  assert.equal(
    scrubUrl("https://user:pw@example.com/pay?utm_source=news&token=abc&page=2#access_token=xyz"),
    "https://example.com/pay?utm_source=news&token=[redacted]&page=2"
  );
  assert.equal(scrubUrl("/checkout?email=ada@example.com#frag"), "/checkout");
});

test("scrubbing is idempotent", () => {
  const input = "ada@example.com paid with 4242 4242 4242 4242 via Bearer abcdef1234567890xyz at https://x.test/a?token=1";
  const once = scrubText(input);
  assert.equal(scrubText(once), once);
});

test("an error payload is scrubbed in message, frames, breadcrumbs and tags", () => {
  const out = scrubErrorPayload({
    type: "Error",
    message: "Payment failed for ada@example.com at https://shop.test/pay?card=4242424242424242&utm_source=x",
    frames: [{ file: "https://shop.test/app.js?v=3#x", fn: "pay", line: 1 }],
    breadcrumbs: [{ ts: 1, k: "fetch", m: "POST https://shop.test/api?token=abc 500" }],
    tags: { user: "ada@example.com" },
  });
  assert.equal(out.message, "Payment failed for [email] at https://shop.test/pay?card=[redacted]&utm_source=x");
  assert.equal(out.frames![0]!.file, "https://shop.test/app.js?v=[redacted]");
  assert.equal(out.breadcrumbs![0]!.m, "POST https://shop.test/api?token=[redacted] 500");
  assert.equal(out.tags!.user, "[email]");
  assert.equal(out.type, "Error");
});
