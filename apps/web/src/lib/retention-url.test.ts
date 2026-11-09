import { test } from "node:test";
import assert from "node:assert/strict";
import { cohortWindow, parseRetentionView, periodLabel, retentionHref } from "./retention-url";

test("unknown values fall back to weekly with no events", () => {
  assert.deepEqual(parseRetentionView({}), { granularity: "week" });
  assert.deepEqual(parseRetentionView({ g: "hour", cohortEvent: "x".repeat(65) }), { granularity: "week" });
});

test("events and granularity are read, arrays take the first value", () => {
  assert.deepEqual(parseRetentionView({ g: ["month", "day"], cohortEvent: " signup ", returnEvent: "purchase" }), {
    granularity: "month",
    cohortEvent: "signup",
    returnEvent: "purchase",
  });
});

test("links leave out defaults and can clear an event", () => {
  const view = parseRetentionView({});
  assert.equal(retentionHref("/r", view), "/r");
  assert.equal(retentionHref("/r", view, { granularity: "day" }), "/r?g=day");
  const withEvent = parseRetentionView({ cohortEvent: "signup", returnEvent: "buy" });
  assert.equal(retentionHref("/r", withEvent, { returnEvent: undefined }), "/r?cohortEvent=signup");
});

test("windows start on a period boundary", () => {
  const now = new Date("2026-11-11T10:00:00Z"); // a Wednesday
  assert.deepEqual(cohortWindow("day", now), { from: "2026-10-29", to: "2026-11-11" });
  assert.deepEqual(cohortWindow("week", now), { from: "2026-09-21", to: "2026-11-11" });
  assert.equal(new Date("2026-09-21T00:00:00Z").getUTCDay(), 1, "the first week starts on a Monday");
  assert.deepEqual(cohortWindow("month", now), { from: "2026-06-01", to: "2026-11-11" });
});

test("column labels name the unit", () => {
  assert.equal(periodLabel("week", 2), "Week 2");
  assert.equal(periodLabel("day", 0), "Day 0");
  assert.equal(periodLabel("month", 1), "Month 1");
});
