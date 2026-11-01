import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrackerEvent } from "@trackme/contracts";
import { limitEvent, limitProperties } from "./limits.js";

const base = {
  schemaVersion: 1,
  eventId: "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42",
  type: "pageview",
  occurredAt: "2026-01-01T00:00:00.000Z",
  siteKey: "site-key-123",
  sessionId: "session-1234",
  visitorPseudonym: "visitor-1234",
  url: "https://example.com/pricing",
  path: "/pricing",
} as unknown as TrackerEvent;

test("a long query does not push the path or url past the edge limits", () => {
  const query = `?token=${"a".repeat(3000)}`;
  const out = limitEvent({ ...base, url: `https://example.com/callback${query}`, path: `/callback${query}` });
  assert.equal(out.path, "/callback");
  assert.equal(out.url, "https://example.com/callback");
});

test("title, referrer and campaign values are cut to their limits", () => {
  const out = limitEvent({
    ...base,
    title: "t".repeat(900),
    referrer: `https://r.example/${"x".repeat(3000)}`,
    campaign: { source: "s".repeat(300), medium: "email" },
  });
  assert.equal(out.title?.length, 512);
  assert.ok((out.referrer?.length ?? 0) <= 2048);
  assert.equal(out.campaign?.source?.length, 128);
  assert.equal(out.campaign?.medium, "email");
});

test("an unusable property is dropped on its own, not the whole event", () => {
  const warn = console.warn;
  const lines: string[] = [];
  console.warn = (line: string) => void lines.push(line);
  try {
    const out = limitProperties(
      {
        plan: "pro",
        seats: 5,
        trial: true,
        coupon: null,
        items: [1, 2],
        nested: { a: 1 },
        "has space": "x",
        note: "v".repeat(400),
      } as never,
      "event properties"
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(out).sort(), ["note", "plan", "seats", "trial"]);
    assert.equal((out.note as string).length, 256);
    assert.ok(lines.some((l) => l.includes("coupon")));
  } finally {
    console.warn = warn;
  }
});

test("at most 50 properties are kept", () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 60; i += 1) many[`k${i}`] = "v";
  const out = limitProperties(many as never, "event properties") as Record<string, unknown>;
  assert.equal(Object.keys(out).length, 50);
});
