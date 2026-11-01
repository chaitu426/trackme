import assert from "node:assert/strict";
import test from "node:test";
import { backfillEventsV2, buildBackfillInsert, planBackfillDays } from "./backfill.js";

test("days run oldest first and inclusive", () => {
  assert.deepEqual(planBackfillDays("2026-10-08", "2026-10-10"), ["2026-10-08", "2026-10-09", "2026-10-10"]);
  assert.deepEqual(planBackfillDays("2026-10-08", "2026-10-08"), ["2026-10-08"]);
  assert.throws(() => planBackfillDays("2026-10-10", "2026-10-08"), RangeError);
});

test("the insert copies by received_at, joins web vitals and keeps the site filter", () => {
  const sql = buildBackfillInsert({ siteId: "x" });
  assert.match(sql, /e\.received_at < \{t0:DateTime64\}/);
  assert.match(sql, /LEFT JOIN[\s\S]*web_vitals FINAL/);
  assert.match(sql, /e\.site_id = \{siteId:UUID\}/);
  assert.doesNotMatch(buildBackfillInsert({}), /siteId/);
});

function fakeClient(counts: Record<string, { legacy: number; v2: number }>) {
  const commands: string[] = [];
  return {
    commands,
    client: {
      async query({ query, query_params }: { query: string; query_params?: Record<string, unknown> }) {
        const day = String(query_params?.day);
        const c = query.includes("FROM events_raw") ? counts[day]!.legacy : counts[day]!.v2;
        return { json: async () => [{ c }] };
      },
      async command({ query_params }: { query: string; query_params?: Record<string, unknown> }) {
        commands.push(String(query_params?.day));
      },
    } as never,
  };
}

test("copies empty days only, skips done ones, and is a no-op in dry-run", async () => {
  const counts = {
    "2026-10-08": { legacy: 5, v2: 5 },
    "2026-10-09": { legacy: 7, v2: 0 },
    "2026-10-10": { legacy: 0, v2: 0 },
  };
  const live = fakeClient(counts);
  const out = await backfillEventsV2(live.client, { from: "2026-10-08", to: "2026-10-10", t0: "2026-10-10T00:00:00Z" });
  assert.deepEqual(out.map((o) => o.action), ["skipped", "copied", "skipped"]);
  assert.deepEqual(live.commands, ["2026-10-09"]);

  const dry = fakeClient(counts);
  const dryOut = await backfillEventsV2(
    dry.client,
    { from: "2026-10-09", to: "2026-10-09", t0: "2026-10-10T00:00:00Z" },
    { dryRun: true }
  );
  assert.equal(dryOut[0]!.action, "dry-run");
  assert.deepEqual(dry.commands, []);
});

test("refuses a partly copied day instead of doubling the aggregates", async () => {
  const { client } = fakeClient({ "2026-10-09": { legacy: 7, v2: 3 } });
  await assert.rejects(
    backfillEventsV2(client, { from: "2026-10-09", to: "2026-10-09", t0: "2026-10-10T00:00:00Z" }),
    /double the sums/
  );
});
