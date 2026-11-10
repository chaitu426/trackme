import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateLeak, MIN_AFFECTED, MIN_CONTROL } from "./revenue-leak.js";

const AOV = 100_000;

test("too few affected sessions publishes no money", () => {
  const e = estimateLeak({ total: 500, totalPaid: 300, affected: MIN_AFFECTED - 1, affectedPaid: 0, aovMinor: AOV });
  assert.equal(e.enough, false);
  assert.equal(e.associatedLossMinor, 0);
  assert.equal(e.incrementalLossMinor, 0);
});

test("too few comparison sessions publishes no money", () => {
  const e = estimateLeak({ total: MIN_AFFECTED + MIN_CONTROL - 1, totalPaid: 10, affected: MIN_AFFECTED, affectedPaid: 1, aovMinor: AOV });
  assert.equal(e.enough, false);
});

test("no average order value means no money", () => {
  assert.equal(estimateLeak({ total: 500, totalPaid: 300, affected: 100, affectedPaid: 10, aovMinor: 0 }).enough, false);
});

test("a clearly worse conversion is costed both ways, with high confidence", () => {
  // 1000 checkout sessions, 600 paid. 200 saw the issue and 40 paid (20%); the other 800 paid 560 (70%).
  const e = estimateLeak({ total: 1000, totalPaid: 600, affected: 200, affectedPaid: 40, aovMinor: AOV });
  assert.equal(e.enough, true);
  assert.equal(e.affectedConversion, 0.2);
  assert.equal(e.controlConversion, 0.7);
  assert.equal(e.associatedLossMinor, 160 * AOV);
  assert.equal(e.incrementalLossMinor, Math.round(0.5 * 200 * AOV));
  assert.equal(e.confidence, "high");
  assert.ok(e.p < 0.001);
});

test("associated is always at least the incremental estimate", () => {
  const e = estimateLeak({ total: 1000, totalPaid: 600, affected: 200, affectedPaid: 90, aovMinor: AOV });
  assert.ok(e.associatedLossMinor >= e.incrementalLossMinor);
});

test("an issue whose sessions convert as well as the rest costs nothing beyond normal drop-off", () => {
  const e = estimateLeak({ total: 1000, totalPaid: 600, affected: 200, affectedPaid: 130, aovMinor: AOV });
  assert.equal(e.incrementalLossMinor, 0);
  assert.equal(e.confidence, "low");
  // They still did not collect from the 70 sessions that did not pay, which is the upper bound.
  assert.equal(e.associatedLossMinor, 70 * AOV);
});

test("a small but real gap is medium confidence", () => {
  const e = estimateLeak({ total: 400, totalPaid: 240, affected: 40, affectedPaid: 14, aovMinor: AOV });
  assert.equal(e.confidence, "medium");
});

test("a gap that could be chance is low confidence", () => {
  const e = estimateLeak({ total: 400, totalPaid: 240, affected: 25, affectedPaid: 13, aovMinor: AOV });
  assert.equal(e.confidence, "low");
});
