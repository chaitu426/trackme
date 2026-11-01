import { test } from "node:test";
import assert from "node:assert/strict";
import { deadLettered, lagAfter, registry } from "./metrics.js";

test("lag is the messages after the last processed offset", () => {
  // high watermark is the offset of the NEXT message to be written
  assert.equal(lagAfter("1000", "999"), 0);
  assert.equal(lagAfter("1000", "899"), 100);
});

test("lag never goes negative if the watermark is stale", () => {
  assert.equal(lagAfter("10", "50"), 0);
});

test("lag handles offsets beyond 2^53 without losing precision", () => {
  assert.equal(lagAfter("9007199254741993", "9007199254740992"), 1000);
});

test("metrics render in Prometheus text format with the dlq reason label", async () => {
  deadLettered.inc({ reason: "contract" });
  const text = await registry.metrics();
  assert.match(text, /worker_dlq_total\{reason="contract"\} 1/);
  assert.match(text, /# TYPE worker_insert_duration_seconds histogram/);
});
