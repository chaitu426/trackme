import { test } from "node:test";
import assert from "node:assert/strict";
import { clampScope, resolveRange, daysBetween, RunInputSchema, MAX_SCOPE_ROWS } from "./scope.js";

const input = {
  workspaceSlug: "acme",
  siteDomains: ["acme.com"],
  range: "30d" as const,
  sources: { traffic: true, errors: true, payments: false },
  piiMasked: true,
  maxRows: 50_000,
  instructions: "x".repeat(2000),
};

test("clampScope caps rows, lists every source, and trims instructions", () => {
  const s = clampScope(input as never);
  assert.equal(s.maxRows, MAX_SCOPE_ROWS);
  assert.equal(s.instructions.length, 800);
  assert.deepEqual(Object.keys(s.sources).sort(), ["errors", "payments", "people", "releases", "traffic"]);
  assert.equal(s.sources.payments, false);
  assert.equal(s.sources.people, false);
});

test("RunInputSchema rejects a missing question and an unknown range", () => {
  assert.equal(RunInputSchema.safeParse({ question: "", scope: input }).success, false);
  assert.equal(RunInputSchema.safeParse({ question: "hi", scope: { ...input, range: "1y" } }).success, false);
});

test("resolveRange is a rolling window ending now, inclusive UTC days", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const r = resolveRange("7d", now);
  assert.equal(r.to, "2026-11-10");
  assert.equal(r.fromIso, "2026-11-03T12:00:00.000Z");
  assert.equal(r.label, "Last 7 days");
  assert.equal(daysBetween("2026-11-03", "2026-11-10"), 8);
});

import { clampToRawScan } from "./scope.js";

test("a range within the raw-scan limit is left alone", () => {
  const range = resolveRange("30d", new Date("2026-11-10T00:00:00Z"));
  assert.deepEqual(clampToRawScan(range, 31), { fromIso: range.fromIso, toIso: range.toIso });
});

test("a wider range is cut to the most recent days and says so", () => {
  const range = resolveRange("90d", new Date("2026-11-10T00:00:00Z"));
  const clamped = clampToRawScan(range, 31);
  assert.equal(clamped.toIso, range.toIso);
  assert.equal((Date.parse(clamped.toIso) - Date.parse(clamped.fromIso)) / 86_400_000, 31);
  assert.match(clamped.note ?? "", /last 31 days, not last 90 days/);
});

test("the clamped range is one the analytics layer accepts", () => {
  const range = resolveRange("90d", new Date("2026-11-10T00:00:00Z"));
  const { fromIso, toIso } = clampToRawScan(range, 31);
  // assertRawScanRange throws only when the span is strictly more than 31 days.
  assert.ok((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000 <= 31);
});
