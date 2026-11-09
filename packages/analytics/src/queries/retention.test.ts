import { test } from "node:test";
import assert from "node:assert/strict";
import { getRetention, periodStart, type RetentionQuery } from "./retention.js";

const SITE = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-11-09T12:00:00Z");

function fake(sizes: unknown[], cells: unknown[]) {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const client = {
    async query({ query, query_params }: { query: string; query_params: Record<string, unknown> }) {
      calls.push({ query, params: query_params });
      return { json: async () => (query.includes("count() AS size") ? sizes : cells) };
    },
  };
  return { client: client as never, calls };
}

const base: RetentionQuery = { siteId: SITE, granularity: "day", from: "2026-11-01", to: "2026-11-05", cohort: { kind: "first_visit" }, periods: 3, now: NOW };

test("period starts step by day, week and calendar month", () => {
  assert.equal(periodStart("2026-11-03", "day", 2), "2026-11-05");
  assert.equal(periodStart("2026-11-02", "week", 2), "2026-11-16");
  assert.equal(periodStart("2026-01-01", "month", 1), "2026-02-01");
  assert.equal(periodStart("2026-12-01", "month", 2), "2027-02-01");
});

test("periods that have not happened yet are null, not zero", async () => {
  const { client } = fake([{ cohort: "2026-11-08", size: 4 }], [{ cohort: "2026-11-08", period: 0, users: 4 }, { cohort: "2026-11-08", period: 1, users: 2 }]);
  const [row] = await getRetention({ ...base, from: "2026-11-08", to: "2026-11-08", periods: 3 }, client);
  // Nov 8 + 1 day = Nov 9 (today, has happened), + 2 = Nov 10 (future).
  assert.deepEqual(row, { cohort: "2026-11-08", size: 4, retained: [4, 2, null, null] });
});

test("a period with nobody active is 0 when it has happened", async () => {
  const { client } = fake([{ cohort: "2026-11-01", size: 3 }], [{ cohort: "2026-11-01", period: 0, users: 3 }]);
  const [row] = await getRetention({ ...base, to: "2026-11-01" }, client);
  assert.deepEqual(row!.retained, [3, 0, 0, 0]);
});

test("the site, dates and event names are bound parameters, never part of the SQL text", async () => {
  const { client, calls } = fake([], []);
  await getRetention(
    { ...base, cohort: { kind: "event", name: "x'; DROP TABLE t; --" }, returnEvent: "y' OR 1=1", userIds: ["u1", "u2"] },
    client
  );
  for (const call of calls) {
    assert.match(call.query, /site_id = \{siteId:UUID\}/);
    assert.equal(call.params.siteId, SITE);
    assert.ok(!call.query.includes("DROP TABLE") && !call.query.includes("OR 1=1"));
  }
  assert.equal(calls[0]!.params.cohortEvent, "x'; DROP TABLE t; --");
  assert.equal(calls[0]!.params.returnEvent, "y' OR 1=1");
  assert.deepEqual(calls[0]!.params.users, ["u1", "u2"]);
});

test("the activity scan stops at the last period needed, or today", async () => {
  const { client, calls } = fake([], []);
  await getRetention({ ...base, to: "2026-11-02", periods: 2 }, client);
  assert.equal(calls[0]!.params.activityTo, "2026-11-05");
  await getRetention({ ...base, to: "2026-11-08", periods: 30 }, client);
  assert.equal(calls[2]!.params.activityTo, "2026-11-09");
});

test("no user filter means everyone; an empty list means no one", async () => {
  const everyone = fake([], []);
  await getRetention(base, everyone.client);
  assert.ok(!everyone.calls[0]!.query.includes("user_id IN"));
  const nobody = fake([], []);
  await getRetention({ ...base, userIds: [] }, nobody.client);
  assert.ok(nobody.calls[0]!.query.includes("user_id IN"));
  assert.deepEqual(nobody.calls[0]!.params.users, []);
});

test("bad dates are refused before any query runs", async () => {
  const { client, calls } = fake([], []);
  for (const bad of [{ from: "yesterday" }, { to: "2026-13-99x" }, { from: "2026-11-09", to: "2026-11-01" }]) {
    await assert.rejects(getRetention({ ...base, ...bad }, client));
  }
  assert.equal(calls.length, 0);
});
