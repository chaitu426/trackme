import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvent } from "./contract.js";

function enriched(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42",
    type: "pageview",
    occurredAt: "2026-10-09T12:00:00.000Z",
    siteKey: "site_key_12345",
    sessionId: "session-1234",
    visitorPseudonym: "visitor-1234",
    url: "https://example.com/pricing",
    path: "/pricing",
    workspaceId: "0b9f6a64-0d1f-4f3a-9c55-2d4f5c0f8a11",
    siteId: "a1c2e3f4-1111-4222-8333-444455556666",
    receivedAt: "2026-10-09T12:00:00.100Z",
    device: "desktop",
    isBot: false,
    botStatus: "human",
    ...overrides,
  };
}

test("a well-formed enriched event passes", () => {
  assert.equal(checkEvent(enriched()).ok, true);
});

test("an event id that is not a UUID is rejected with a reason naming the field", () => {
  const verdict = checkEvent(enriched({ eventId: "not-a-uuid" }));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /eventId/);
});

test("an unparseable timestamp is rejected", () => {
  const verdict = checkEvent(enriched({ occurredAt: "yesterday" }));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /occurredAt/);
});

test("a UTC offset timestamp is rejected, so the edge must normalize to Z", () => {
  assert.equal(checkEvent(enriched({ occurredAt: "2026-10-09T17:30:00.000+05:30" })).ok, false);
});

test("a missing tenant id is rejected", () => {
  assert.equal(checkEvent(enriched({ workspaceId: undefined })).ok, false);
});

test("non-object payloads are rejected", () => {
  assert.equal(checkEvent("hello").ok, false);
  assert.equal(checkEvent(42).ok, false);
  assert.equal(checkEvent([]).ok, false);
});

test("an identify event with user fields passes", () => {
  const verdict = checkEvent(enriched({ type: "identify", userId: "user-42", userTraits: { plan: "pro" } }));
  assert.equal(verdict.ok, true);
});
