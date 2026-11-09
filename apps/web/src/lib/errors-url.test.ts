import { test } from "node:test";
import assert from "node:assert/strict";
import { errorsHref, fillDays, parseErrorFilters, rangeDates } from "./errors-url";

test("unknown or hostile query values fall back to defaults", () => {
  assert.deepEqual(parseErrorFilters({}), { range: "30d", status: "open", sort: "last_seen" });
  const f = parseErrorFilters({ status: "weird", sort: "drop", level: "panic", cursor: "1; DROP", range: "99y", release: "x".repeat(65) });
  assert.deepEqual(f, { range: "30d", status: "open", sort: "last_seen" });
});

test("valid filters are read, and arrays take their first value", () => {
  const f = parseErrorFilters({ status: ["resolved", "open"], sort: "users", level: "warning", release: " web@1 ", environment: "staging", range: "7d", cursor: "12:34" });
  assert.deepEqual(f, { range: "7d", status: "resolved", sort: "users", level: "warning", release: "web@1", environment: "staging", cursor: "12:34" });
});

test("links leave out defaults, and changing a filter drops the cursor", () => {
  const base = parseErrorFilters({});
  assert.equal(errorsHref("/x", base), "/x");
  assert.equal(errorsHref("/x", base, { status: "resolved", release: "web@1" }), "/x?status=resolved&release=web%401");
  const paged = parseErrorFilters({ cursor: "5:6", sort: "events" });
  assert.equal(errorsHref("/x", paged, { status: "all" }), "/x?status=all&sort=events");
  assert.equal(errorsHref("/x", paged, { cursor: "9:9" }), "/x?sort=events&cursor=9%3A9");
});

test("range dates cover the right UTC days", () => {
  const now = new Date("2026-11-09T05:00:00Z");
  assert.deepEqual(rangeDates("24h", now).days, ["2026-11-08", "2026-11-09"]);
  assert.equal(rangeDates("7d", now).days.length, 7);
  assert.deepEqual([rangeDates("7d", now).from, rangeDates("7d", now).to], ["2026-11-03", "2026-11-09"]);
  assert.equal(rangeDates("30d", now).days.length, 30);
});

test("daily counts are zero-filled across the range", () => {
  assert.deepEqual(fillDays(["a", "b", "c"], [{ date: "b", events: 4 }]), [0, 4, 0]);
});
