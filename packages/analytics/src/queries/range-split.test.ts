import { test } from "node:test";
import assert from "node:assert/strict";
import { splitRange, toClickHouseDateTime } from "./range-split.js";

test("a rolling 7-day range has 6 whole days and two partial edges", () => {
  const s = splitRange("2026-10-03T15:20:00.000Z", "2026-10-10T15:20:00.000Z");
  assert.equal(s.hasFullDays, true);
  assert.equal(s.headEnd.toISOString(), "2026-10-04T00:00:00.000Z");
  assert.equal(s.tailStart.toISOString(), "2026-10-10T00:00:00.000Z");
  assert.equal(s.fullFromDate, "2026-10-04");
  assert.equal(s.fullToDate, "2026-10-10"); // exclusive: Oct 4..9 = 6 days
});

test("the day containing `to` is never read from rollups, because it is unfinished", () => {
  const s = splitRange("2026-10-01T00:00:00.000Z", "2026-10-10T23:59:59.000Z");
  assert.equal(s.fullToDate, "2026-10-10");
});

test("a range starting exactly at midnight has no head edge", () => {
  const s = splitRange("2026-10-03T00:00:00.000Z", "2026-10-10T12:00:00.000Z");
  assert.equal(s.headEnd.toISOString(), "2026-10-03T00:00:00.000Z");
  assert.equal(s.fullFromDate, "2026-10-03");
});

test("a range ending exactly at midnight has no tail edge beyond the instant itself", () => {
  const s = splitRange("2026-10-03T06:00:00.000Z", "2026-10-10T00:00:00.000Z");
  assert.equal(s.tailStart.toISOString(), "2026-10-10T00:00:00.000Z");
  assert.equal(s.fullToDate, "2026-10-10");
});

test("a range inside one day has no whole days", () => {
  const s = splitRange("2026-10-10T01:00:00.000Z", "2026-10-10T20:00:00.000Z");
  assert.equal(s.hasFullDays, false);
});

test("a range spanning one midnight but no whole day has no whole days", () => {
  const s = splitRange("2026-10-09T20:00:00.000Z", "2026-10-10T04:00:00.000Z");
  assert.equal(s.hasFullDays, false);
});

test("exactly one whole day", () => {
  const s = splitRange("2026-10-09T20:00:00.000Z", "2026-10-11T04:00:00.000Z");
  assert.equal(s.hasFullDays, true);
  assert.equal(s.fullFromDate, "2026-10-10");
  assert.equal(s.fullToDate, "2026-10-11");
});

test("the whole days plus both edges cover the range with no gap and no overlap", () => {
  const from = new Date("2026-09-10T17:45:12.345Z");
  const to = new Date("2026-10-10T03:10:00.000Z");
  const s = splitRange(from.toISOString(), to.toISOString());
  const head = s.headEnd.getTime() - from.getTime();
  const days = new Date(s.fullToDate).getTime() - new Date(s.fullFromDate).getTime();
  const tail = to.getTime() - s.tailStart.getTime();
  assert.equal(head + days + tail, to.getTime() - from.getTime());
  assert.ok(head >= 0 && head < 86_400_000);
  assert.ok(tail >= 0 && tail < 86_400_000);
});

test("the month and year boundaries are handled", () => {
  const s = splitRange("2025-12-29T10:00:00.000Z", "2026-01-03T10:00:00.000Z");
  assert.equal(s.fullFromDate, "2025-12-30");
  assert.equal(s.fullToDate, "2026-01-03");
});

test("an invalid or reversed range is an error, not a silent empty answer", () => {
  assert.throws(() => splitRange("nope", "2026-10-10T00:00:00.000Z"), RangeError);
  assert.throws(() => splitRange("2026-10-10T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), RangeError);
});

test("ClickHouse literals match the format the other queries use", () => {
  assert.equal(toClickHouseDateTime(new Date("2026-10-04T00:00:00.000Z")), "2026-10-04 00:00:00.000");
});
