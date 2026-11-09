import { test } from "node:test";
import assert from "node:assert/strict";
import { binomialTail, detectIncidents, type HealthBucket } from "./payments-health.js";

const T0 = Date.UTC(2026, 0, 10, 0, 0, 0);
const bucket = (i: number, paid: number, failed: number, topFailure = ""): HealthBucket => ({ startMs: T0 + i * 300_000, paid, failed, topFailure });
const normal = (count: number) => Array.from({ length: count }, (_, i) => bucket(i, 19, 1, "bank:declined"));

test("binomial tail matches known values", () => {
  assert.ok(Math.abs(binomialTail(10, 0, 0.5) - 1) < 1e-12);
  assert.ok(Math.abs(binomialTail(10, 10, 0.5) - 1 / 1024) < 1e-12);
  assert.ok(Math.abs(binomialTail(4, 2, 0.5) - 11 / 16) < 1e-12);
});

test("a steady gateway has no incident", () => {
  assert.deepEqual(detectIncidents(normal(200), T0 + 300 * 300_000), []);
});

test("a stretch of failures is one incident with its dominant code", () => {
  const b = normal(200);
  for (let i = 100; i < 110; i += 1) b[i] = bucket(i, 2, 8, "gateway:timeout");
  const found = detectIncidents(b, T0 + 300 * 300_000);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.startMs, T0 + 100 * 300_000);
  assert.equal(found[0]!.endMs, T0 + 110 * 300_000);
  assert.equal(found[0]!.topFailure, "gateway:timeout");
  assert.equal(found[0]!.ongoing, false);
  assert.ok(found[0]!.successRate < 0.3);
});

test("one unlucky quiet bucket is not an incident", () => {
  const b = normal(200);
  b[50] = bucket(50, 1, 2, "x");
  assert.deepEqual(detectIncidents(b, T0 + 300 * 300_000), []);
});

test("an incident that is still running is marked ongoing", () => {
  const b = normal(100);
  for (let i = 94; i < 100; i += 1) b[i] = bucket(i, 1, 9, "gateway:timeout");
  const found = detectIncidents(b, T0 + 100 * 300_000);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.ongoing, true);
});

test("too little history says nothing", () => {
  assert.deepEqual(detectIncidents([bucket(0, 0, 10, "x")], T0 + 600_000), []);
});
