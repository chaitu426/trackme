import { test } from "node:test";
import assert from "node:assert/strict";
import { leaksToCsv, type RevenueLeaks } from "./revenue-leaks.js";

const base: RevenueLeaks = {
  sessions: 500, paid: 300, conversion: 0.6, currency: "INR", aovMinor: 100_000, sessionsWithErrors: 80,
  issues: [
    { groupId: "123", title: 'Cannot read "items", of undefined', etype: "TypeError", affected: 100, affectedPaid: 20, affectedConversion: 0.2, controlConversion: 0.7, associatedLossMinor: 8_000_000, incrementalLossMinor: 5_000_000, confidence: "high", enough: true },
    { groupId: "456", title: "=HYPERLINK(\"http://evil\")", etype: "Error", affected: 5, affectedPaid: 1, affectedConversion: 0.2, controlConversion: 0.6, associatedLossMinor: null, incrementalLossMinor: null, confidence: "low", enough: false },
  ],
};

test("the CSV has a header, one line per issue, and quotes every cell", () => {
  const lines = leaksToCsv(base).trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0]!.startsWith('"Issue","Type"'));
  assert.ok(lines[1]!.includes('"Cannot read ""items"", of undefined"'));
});

test("money is in major units and a missing figure is an empty cell", () => {
  const lines = leaksToCsv(base).trim().split("\r\n");
  assert.ok(lines[1]!.includes('"80000.00","50000.00"'));
  assert.ok(lines[2]!.includes('"","","low","no (needs 20 sessions)"'));
});

test("a title that starts like a spreadsheet formula cannot run as one", () => {
  const second = leaksToCsv(base).trim().split("\r\n")[2]!;
  assert.ok(second.startsWith(`"'=HYPERLINK`));
});
