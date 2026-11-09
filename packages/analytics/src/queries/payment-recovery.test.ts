import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntil, earlierDelay } from "./payment-recovery.js";

test("the earlier of two recovery delays wins, and a missing one is ignored", () => {
  assert.equal(earlierDelay(undefined, undefined), undefined);
  assert.equal(earlierDelay(100, undefined), 100);
  assert.equal(earlierDelay(undefined, 50), 50);
  assert.equal(earlierDelay(100, 50), 50);
});

test("days until a dispute is due rounds up, goes negative when overdue, and is null without a deadline", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(daysUntil(null, now), null);
  assert.equal(daysUntil("2026-11-12T12:00:00Z", now), 3);
  assert.equal(daysUntil("2026-11-09T18:00:00Z", now), 1);
  assert.equal(daysUntil("2026-11-08T00:00:00Z", now), -1);
});
