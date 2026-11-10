import { test } from "node:test";
import assert from "node:assert/strict";
import { leakDays, LEAK_DAY_SQL, runRevenueLeakRollup } from "./revenue-leak-rollup.js";

test("the days recomputed are today and the days before, oldest first", () => {
  assert.deepEqual(leakDays(new Date("2026-11-09T05:00:00Z"), 3), ["2026-11-07", "2026-11-08", "2026-11-09"]);
});

test("one statement per day, each with its day and the checkout path as bound parameters", async () => {
  const calls: Array<{ query: string; query_params?: Record<string, unknown> }> = [];
  const n = await runRevenueLeakRollup({ command: async (c) => void calls.push(c) } as never, { days: 2, now: new Date("2026-11-09T05:00:00Z"), checkoutPath: "/pay" });
  assert.equal(n, 2);
  assert.deepEqual(calls.map((c) => c.query_params), [
    { day: "2026-11-08", checkout: "/pay" },
    { day: "2026-11-09", checkout: "/pay" },
  ]);
  assert.ok(calls.every((c) => c.query === LEAK_DAY_SQL));
});

test("the statement is bound by day and writes by key, with no value interpolated into it", () => {
  assert.match(LEAK_DAY_SQL, /\{day:Date\}/);
  assert.match(LEAK_DAY_SQL, /\{checkout:String\}/);
  assert.ok(!LEAK_DAY_SQL.includes("/checkout"));
});
