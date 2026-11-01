import assert from "node:assert/strict";
import test from "node:test";
import { compareDay, duplicateRate, runReconciliation, type DayTotals, type ReconciliationClient } from "./reconciliation.js";

const totals = (pageviews: number, visitors: number): DayTotals => ({ pageviews, visitors });

test("matching and nearly matching days produce no mismatch", () => {
  const agg = new Map([["a", totals(1000, 200)], ["b", totals(5, 3)]]);
  const raw = new Map([["a", totals(1003, 202)], ["b", totals(6, 3)]]); // 0.3 %, 1 %, and tiny counts
  assert.deepEqual(compareDay("2026-10-12", agg, raw), []);
});

test("drift beyond tolerance is reported per kind", () => {
  const agg = new Map([["a", totals(900, 200)], ["b", totals(1000, 150)]]);
  const raw = new Map([["a", totals(1000, 200)], ["b", totals(1000, 200)]]);
  const kinds = compareDay("d", agg, raw).map((m) => `${m.siteId}:${m.kind}`).sort();
  assert.deepEqual(kinds, ["a:pageviews", "b:visitors"]);
});

test("a site present on only one side is reported", () => {
  const kinds = compareDay("d", new Map([["a", totals(10, 5)]]), new Map([["b", totals(10, 5)]])).map((m) => m.kind).sort();
  assert.deepEqual(kinds, ["missing_aggregate", "missing_raw"]);
});

function client(rows: Record<string, unknown[]>): ReconciliationClient {
  return {
    async query({ query }) {
      const key = query.includes("site_daily_agg") ? "agg" : query.includes("uniqExact(event_id)") ? "dup" : "raw";
      return { json: async <T,>() => rows[key] as T[] };
    },
  };
}

test("duplicate rate is the share of repeated event ids", async () => {
  const report = await duplicateRate(client({ dup: [{ total: "1000", uniq: "990" }] }), "d");
  assert.equal(report.duplicates, 10);
  assert.equal(report.rate, 0.01);
});

test("the nightly run checks yesterday and last week and raises alerts for drift and duplicates", async () => {
  const lines: string[] = [];
  const result = await runReconciliation({
    now: new Date("2026-10-13T04:00:00Z"),
    log: (l) => lines.push(l),
    client: client({
      agg: [{ site_id: "s", pageviews: 50, visitors: 10 }],
      raw: [{ site_id: "s", pageviews: 100, visitors: 10 }],
      dup: [{ total: 1000, uniq: 900 }],
    }),
  });
  assert.equal(result.mismatches.length, 2); // pageviews drift on both days
  assert.deepEqual(result.mismatches.map((m) => m.day), ["2026-10-12", "2026-10-06"]);
  assert.equal(result.duplicates.length, 2);
  assert.ok(result.alerts.length >= 4);
  assert.ok(lines.some((l) => l.includes("duplicate event ids")));
});

test("a clean night raises nothing", async () => {
  const result = await runReconciliation({
    now: new Date("2026-10-13T04:00:00Z"),
    log: () => assert.fail("nothing should be logged"),
    client: client({
      agg: [{ site_id: "s", pageviews: 100, visitors: 10 }],
      raw: [{ site_id: "s", pageviews: 100, visitors: 10 }],
      dup: [{ total: 1000, uniq: 1000 }],
    }),
  });
  assert.deepEqual(result.alerts, []);
});
