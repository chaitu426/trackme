import { test } from "node:test";
import assert from "node:assert/strict";
import { planRows, proHighlights } from "./plan-copy";

const row = (label: string) => planRows().find((r) => r.label === label)!;

test("the comparison shows exactly what the plan table enforces", () => {
  assert.deepEqual([row("Websites").free, row("Websites").pro], ["1", "10"]);
  assert.deepEqual([row("Events per month").free, row("Events per month").pro], ["50,000", "1,000,000"]);
  assert.deepEqual([row("Viewers").free, row("Viewers").pro], ["2", "Unlimited"]);
  assert.deepEqual([row("Data retention").free, row("Data retention").pro], ["6 months", "24 months"]);
  assert.deepEqual([row("Teams and per-site access").free, row("Teams and per-site access").pro], ["Not included", "Included"]);
  assert.deepEqual([row("Funnels / goals / segments").free, row("Funnels / goals / segments").pro], ["1 / 3 / 1", "Unlimited / Unlimited / Unlimited"]);
  assert.equal(row("Alert channels").free, "Email only");
  assert.equal(row("Exports").free, "CSV only");
});

test("the upgrade highlights are drawn from the Pro plan", () => {
  const lines = proHighlights();
  assert.ok(lines.some((l) => l.includes("10 websites")));
  assert.ok(lines.some((l) => l.includes("1,000,000 events")));
  assert.ok(lines.some((l) => l.includes("24 months")));
});
