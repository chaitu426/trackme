import { test } from "node:test";
import assert from "node:assert/strict";
import { planDays, type WindowInput } from "./window.js";

const base: WindowInput = {
  today: "2026-10-10",
  lastDate: "2026-10-10",
  earliestEvent: "2026-01-01",
  lookbackDays: 2,
  backfillDays: 65,
  maxDaysPerRun: 14,
};

test("a healthy table recomputes the lookback window and today", () => {
  assert.deepEqual(planDays(base), ["2026-10-08", "2026-10-09", "2026-10-10"]);
});

test("after downtime the run resumes from the newest rolled-up day, not from the lookback window", () => {
  const days = planDays({ ...base, lastDate: "2026-10-04" });
  assert.equal(days[0], "2026-10-03");
  assert.equal(days.at(-1), "2026-10-10");
  assert.equal(days.length, 8);
});

test("a gap longer than the backfill limit is clamped to the limit", () => {
  const days = planDays({ ...base, lastDate: "2026-03-01", backfillDays: 30, maxDaysPerRun: 1000 });
  assert.equal(days[0], "2026-09-10");
  assert.equal(days.length, 31);
});

test("an empty table is seeded from the first day with data", () => {
  const days = planDays({ ...base, lastDate: null, earliestEvent: "2026-10-05" });
  assert.deepEqual(days, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
});

test("an empty table never backfills further than the limit", () => {
  const days = planDays({ ...base, lastDate: null, earliestEvent: "2020-01-01", backfillDays: 10, maxDaysPerRun: 1000 });
  assert.equal(days[0], "2026-09-30");
  assert.equal(days.length, 11);
});

test("an empty table with no events at all does nothing but today", () => {
  assert.deepEqual(planDays({ ...base, lastDate: null, earliestEvent: null }), ["2026-10-10"]);
});

test("a backlog is processed oldest first and capped per run, so the table's end advances", () => {
  const first = planDays({ ...base, lastDate: null, earliestEvent: "2026-08-01", backfillDays: 90, maxDaysPerRun: 14 });
  assert.equal(first.length, 14);
  assert.equal(first[0], "2026-08-01");

  // Next run: the table now ends at the last day processed, so it resumes there.
  const second = planDays({ ...base, lastDate: first.at(-1) as string, backfillDays: 90, maxDaysPerRun: 14 });
  assert.equal(second[0], "2026-08-13");
});

test("a table that is ahead of today (clock skew) still returns a valid window", () => {
  const days = planDays({ ...base, lastDate: "2026-10-12" });
  assert.deepEqual(days, ["2026-10-08", "2026-10-09", "2026-10-10"]);
});

test("a lookback of zero still includes today", () => {
  assert.deepEqual(planDays({ ...base, lookbackDays: 0, lastDate: "2026-10-10" }), ["2026-10-09", "2026-10-10"]);
});

test("month and year boundaries are walked correctly", () => {
  const days = planDays({ ...base, today: "2027-01-02", lastDate: "2026-12-30", lookbackDays: 1 });
  assert.deepEqual(days, ["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("an invalid date is an error, not a silent empty plan", () => {
  assert.throws(() => planDays({ ...base, today: "not-a-date" }), RangeError);
});
