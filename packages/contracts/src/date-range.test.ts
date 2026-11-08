import { test } from "node:test";
import assert from "node:assert/strict";
import { DateRangeSchema } from "./analytics.js";

const range = (from: string, to: string, granularity?: string) => DateRangeSchema.safeParse({ from, to, granularity });
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();

test("ordinary dashboard ranges are accepted", () => {
  assert.ok(range(day(0), day(30), "day").success);
  assert.ok(range(day(0), day(1), "minute").success); // 1,440 points
  assert.ok(range(day(0), day(30), "hour").success); // 720 points
  assert.ok(range(day(0), day(365), "month").success);
});

test("a reversed range is rejected", () => {
  assert.equal(range(day(5), day(1)).success, false);
});

test("a range longer than a year is rejected", () => {
  assert.equal(range(day(0), day(400), "month").success, false);
});

test("a granularity that would return too many points is rejected", () => {
  assert.equal(range(day(0), day(10), "minute").success, false); // 14,400 points
  assert.equal(range(day(0), day(300), "hour").success, false); // 7,200 points
});

test("granularity still defaults to day", () => {
  const parsed = DateRangeSchema.parse({ from: day(0), to: day(7) });
  assert.equal(parsed.granularity, "day");
});
