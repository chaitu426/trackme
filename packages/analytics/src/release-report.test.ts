import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, percentile, type ReportInput, type SideInput } from "./release-report.js";

const row = (value: string, sessions: number, errorSessions: number, errors = errorSessions) => ({ value, sessions, errorSessions, errors });
const side = (over: Partial<SideInput> = {}): SideInput => ({ total: row("", 2000, 60), byDimension: {}, lcp: [], inp: [], conversion: null, ...over });
const input = (before: SideInput, after: SideInput, over: Partial<ReportInput> = {}): ReportInput => ({
  release: "web@2", previousRelease: "web@1", deployedAt: "2026-11-09T10:00:00Z", windowHours: 24, before, after, newIssues: [], regressions: 0, ...over,
});

test("the percentile interpolates and survives an empty sample", () => {
  assert.equal(percentile([], 0.75), 0);
  assert.equal(percentile([10], 0.75), 10);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.75), 4);
});

test("the same error rate before and after is healthy", () => {
  const r = buildReport(input(side(), side()));
  assert.equal(r.verdict, "healthy");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.metrics.find((m) => m.key === "error_sessions")!.worseBy, 0);
});

test("a tripled error rate on real traffic is Regressed, with the reason spelled out", () => {
  const r = buildReport(input(side({ total: row("", 2000, 60) }), side({ total: row("", 2000, 180) })));
  assert.equal(r.verdict, "regressed");
  assert.match(r.reasons[0]!, /Sessions with an error 200% worse \(p < 0\.001, n=2,000\)/);
});

test("too little traffic gives no verdict however bad the numbers look", () => {
  const r = buildReport(input(side({ total: row("", 300, 3) }), side({ total: row("", 300, 60) })));
  assert.equal(r.verdict, "collecting");
});

test("with no previous release there is nothing to compare with", () => {
  const r = buildReport(input(side({ total: null }), side(), { previousRelease: null }));
  assert.equal(r.comparable, false);
  assert.equal(r.verdict, "collecting");
});

test("fewer errors after the release is healthy, not a flag", () => {
  const r = buildReport(input(side({ total: row("", 2000, 200) }), side({ total: row("", 2000, 50) })));
  assert.equal(r.verdict, "healthy");
});

test("a slower LCP is Regressed only when the whole distribution moved", () => {
  const fast = Array.from({ length: 200 }, (_, i) => 1800 + (i % 50) * 10);
  const slow = fast.map((v) => v * 1.5);
  const r = buildReport(input(side({ lcp: fast }), side({ lcp: slow })));
  assert.equal(r.verdict, "regressed");
  assert.match(r.reasons.join(" "), /LCP .*worse/);
  const same = buildReport(input(side({ lcp: fast }), side({ lcp: [...fast] })));
  assert.equal(same.verdict, "healthy");
});

test("a conversion drop is the bad direction, and a rise is not flagged", () => {
  const drop = buildReport(input(side({ conversion: { sessions: 2000, converted: 200 } }), side({ conversion: { sessions: 2000, converted: 100 } }), { goalName: "Signup" }));
  assert.equal(drop.verdict, "regressed");
  assert.match(drop.reasons[0]!, /Conversion: Signup 50% worse/);
  const rise = buildReport(input(side({ conversion: { sessions: 2000, converted: 100 } }), side({ conversion: { sessions: 2000, converted: 200 } })));
  assert.equal(rise.verdict, "healthy");
});

test("the breakdown points at the browser where the errors landed, and ignores small or healthy groups", () => {
  const before = side({
    total: row("", 2000, 60),
    byDimension: { browser: [row("Chrome", 1200, 36), row("Safari", 600, 18), row("Edge", 40, 1)] },
  });
  const after = side({
    total: row("", 2000, 150),
    byDimension: { browser: [row("Chrome", 1200, 38), row("Safari", 600, 110), row("Edge", 40, 30)] },
  });
  const r = buildReport(input(before, after));
  assert.deepEqual(r.breakdown.map((b) => `${b.dimension}:${b.value}`), ["browser:Safari"], "Chrome is flat and Edge has too few sessions");
  assert.match(r.reasons[0]!, /concentrated on browser Safari/);
});

test("a group that is nearly all the traffic is not offered as a place where it went wrong", () => {
  const before = side({ total: row("", 2000, 60), byDimension: { device: [row("desktop", 1990, 60)] } });
  const after = side({ total: row("", 2000, 180), byDimension: { device: [row("desktop", 1990, 180)] } });
  assert.deepEqual(buildReport(input(before, after)).breakdown, []);
});

test("new issues and regressions pass through", () => {
  const issue = { groupId: "1", title: "TypeError: boom", events: 12 };
  const r = buildReport(input(side(), side(), { newIssues: [issue], regressions: 2 }));
  assert.deepEqual([r.newIssues, r.regressions], [[issue], 2]);
});

test("a metric with no data on either side is left out rather than shown as zero", () => {
  const r = buildReport(input(side({ lcp: [] }), side({ lcp: [] })));
  assert.ok(!r.metrics.some((m) => m.key === "lcp" || m.key === "conversion"));
});

test("a clear, large, well-evidenced regression suggests considering a rollback; a modest one does not", () => {
  const big = buildReport(input(side({ total: row("", 2000, 60) }), side({ total: row("", 2000, 180) })));
  assert.equal(big.verdict, "regressed");
  assert.equal(big.rollbackSuggested, true);
  // 40% worse and clearly significant is Regressed, but below the 50% bar for suggesting a rollback.
  const modest = buildReport(input(side({ total: row("", 20000, 600) }), side({ total: row("", 20000, 840) })));
  assert.equal(modest.verdict, "regressed");
  assert.equal(modest.rollbackSuggested, false);
  assert.equal(buildReport(input(side(), side())).rollbackSuggested, false);
});

test("the same hours a week earlier are reported as a baseline when there was traffic", () => {
  const r = buildReport(input(side(), side(), { baselineWeekAgo: row("", 800, 24) }));
  assert.deepEqual(r.baseline, { errorRate: 0.03, sessions: 800 });
  assert.equal(buildReport(input(side(), side(), { baselineWeekAgo: null })).baseline, null);
  assert.equal(buildReport(input(side(), side())).baseline, null);
});
