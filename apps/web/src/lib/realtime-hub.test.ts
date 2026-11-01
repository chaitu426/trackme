import assert from "node:assert/strict";
import test from "node:test";
import { jitteredDelay } from "./realtime-hub";

test("fallback delay stays within +/-20% of the base", () => {
  assert.equal(jitteredDelay(5000, () => 0), 4000);
  assert.equal(jitteredDelay(5000, () => 0.5), 5000);
  assert.equal(jitteredDelay(5000, () => 1), 6000);
});

test("jitter actually spreads hubs across the window", () => {
  const seen = new Set(Array.from({ length: 50 }, () => jitteredDelay(5000)));
  assert.ok(seen.size > 10);
});
