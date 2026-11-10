import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLatencies, compareRates, decideVerdict, normalCdf, twoSidedP, type MetricFinding } from "./stats.js";

const close = (actual: number, expected: number, tolerance: number, label = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

test("the normal CDF matches known values", () => {
  close(normalCdf(0), 0.5, 1e-7);
  close(normalCdf(1.959964), 0.975, 2e-7);
  close(normalCdf(-1.959964), 0.025, 2e-7);
  close(normalCdf(2.575829), 0.995, 2e-7);
  close(normalCdf(-5), 2.8665e-7, 5e-8);
  close(twoSidedP(1.959964), 0.05, 4e-7);
});

test("two-proportion z-test: the textbook case 30/1000 vs 50/1000", () => {
  const r = compareRates(30, 1000, 50, 1000);
  close(r.z, 2.2822, 0.001, "z");
  close(r.p, 0.0225, 0.0005, "p");
  assert.equal(r.ratio, 50 / 30);
  close(r.diff, 0.02, 1e-12);
});

test("equal rates are not significant, and empty or all-zero data is handled", () => {
  assert.ok(compareRates(50, 1000, 50, 1000).p > 0.99);
  assert.equal(compareRates(0, 1000, 0, 1000).p, 1);
  assert.equal(compareRates(0, 0, 0, 0).p, 1);
  assert.equal(compareRates(0, 1000, 5, 1000).ratio, null, "no ratio against a zero baseline");
});

test("a small change on little traffic is not significant; the same change on a lot is", () => {
  assert.ok(compareRates(3, 100, 5, 100).p > 0.3);
  assert.ok(compareRates(3000, 100000, 3300, 100000).p < 0.001);
});

test("Mann-Whitney: fully separated samples", () => {
  const r = compareLatencies([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(r.probabilityHigher, 1);
  assert.ok(r.p < 0.001);
  assert.ok(r.z > 0, "after is higher");
  assert.deepEqual([r.medianBefore, r.medianAfter], [5.5, 15.5]);
});

test("Mann-Whitney: the same distribution, and the direction flips with the data", () => {
  const a = Array.from({ length: 50 }, (_, i) => i * 3);
  assert.ok(compareLatencies(a, a).p > 0.95);
  close(compareLatencies(a, a).probabilityHigher, 0.5, 0.02);
  const faster = compareLatencies([10, 11, 12, 13, 14, 15, 16, 17, 18], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(faster.probabilityHigher, 0);
  assert.ok(faster.z < 0);
});

test("Mann-Whitney: heavy ties do not break it, all-equal samples give p = 1, tiny samples give no claim", () => {
  const tied = compareLatencies(Array(30).fill(100), Array(30).fill(100));
  assert.equal(tied.p, 1);
  const mostlyTied = compareLatencies([...Array(25).fill(100), 120], [...Array(25).fill(100), 400]);
  assert.ok(Number.isFinite(mostlyTied.p) && mostlyTied.p >= 0 && mostlyTied.p <= 1);
  assert.equal(compareLatencies([1], [2, 3]).p, 1);
  assert.equal(compareLatencies([], []).p, 1);
});

test("Mann-Whitney is not fooled by one huge outlier in an otherwise equal sample", () => {
  const before = Array.from({ length: 40 }, (_, i) => 100 + (i % 7));
  const after = [...Array.from({ length: 39 }, (_, i) => 100 + (i % 7)), 60_000];
  assert.ok(compareLatencies(before, after).p > 0.3, "a means-based test would call this a big regression");
});

const finding = (over: Partial<MetricFinding>): MetricFinding => ({ metric: "error rate", worse: true, p: 0.5, relativeChange: 0, n: 1000, ...over });

test("below the sample gate there is no verdict, whatever the numbers say", () => {
  const f = [finding({ p: 0.0001, relativeChange: 3 })];
  assert.equal(decideVerdict(499, 5000, f).verdict, "collecting");
  assert.equal(decideVerdict(5000, 10, f).verdict, "collecting");
  assert.equal(decideVerdict(500, 500, f).verdict, "regressed");
});

test("regressed needs both significance and a real-sized change", () => {
  assert.equal(decideVerdict(2000, 2000, [finding({ p: 0.001, relativeChange: 0.3 })]).verdict, "regressed");
  assert.equal(decideVerdict(2000, 2000, [finding({ p: 0.001, relativeChange: 0.05 })]).verdict, "healthy", "significant but trivial");
  assert.equal(decideVerdict(2000, 2000, [finding({ p: 0.2, relativeChange: 2 })]).verdict, "healthy", "big but noise");
});

test("watch sits between healthy and regressed", () => {
  assert.equal(decideVerdict(2000, 2000, [finding({ p: 0.03, relativeChange: 0.15 })]).verdict, "watch");
  assert.equal(decideVerdict(2000, 2000, [finding({ p: 0.03, relativeChange: 0.15 }), finding({ metric: "LCP", p: 0.001, relativeChange: 0.5 })]).verdict, "regressed");
});

test("improvements and metrics without a baseline never raise a flag", () => {
  assert.equal(decideVerdict(2000, 2000, [finding({ worse: false, p: 0.0001, relativeChange: -0.5 })]).verdict, "healthy");
  assert.equal(decideVerdict(2000, 2000, [finding({ p: 0.0001, relativeChange: null })]).verdict, "healthy");
});

test("the reasons returned are the findings that triggered the verdict", () => {
  const bad = finding({ metric: "checkout errors", p: 0.002, relativeChange: 2.1 });
  const out = decideVerdict(3000, 3000, [finding({}), bad]);
  assert.deepEqual(out.reasons, [bad]);
});
