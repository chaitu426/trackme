import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RETENTION_TABLES,
  buildRetentionDeleteQuery,
  cutoffForRetention,
  retentionMonthsForSite,
  runRetentionCleanup,
} from "./retention.js";

test("retention cutoffs clamp site settings to a safe range", () => {
  assert.equal(retentionMonthsForSite("18", 24), 18);
  assert.equal(retentionMonthsForSite("0", 24), 1);
  assert.equal(retentionMonthsForSite("90", 24), 60);
  assert.equal(retentionMonthsForSite(undefined, 24), 24);
});

test("retention queries include the site id and the correct cutoff for site settings", () => {
  const cutoff = cutoffForRetention(new Date("2026-10-10T12:00:00.000Z"), 6);
  const query = buildRetentionDeleteQuery("events_raw", "timestamp", "datetime", cutoff, ["11111111-1111-1111-1111-111111111111"]);

  assert.match(query, /ALTER TABLE events_raw DELETE WHERE timestamp < '2026-04-01 00:00:00' AND site_id IN \('11111111-1111-1111-1111-111111111111'\)/);
});

test("retention cleanup respects per-site retention values", async () => {
  const commands: string[] = [];
  const dbClient = {
    select() {
      return {
        from: async () => [
          { id: "11111111-1111-1111-1111-111111111111", retentionMonths: 6 },
          { id: "22222222-2222-2222-2222-222222222222", retentionMonths: 12 },
        ],
      };
    },
  };
  const client = {
    async command({ query }: { query: string }) {
      commands.push(query);
    },
  };

  await runRetentionCleanup({
    client: client as never,
    dbClient: dbClient as never,
    now: new Date("2026-10-10T12:00:00.000Z"),
  });

  assert.ok(commands.some((query) => query.includes("ALTER TABLE events_raw DELETE WHERE timestamp < '2026-04-01 00:00:00' AND site_id IN ('11111111-1111-1111-1111-111111111111')")));
  assert.ok(commands.some((query) => query.includes("ALTER TABLE pageview_rollups_daily DELETE WHERE date < '2025-10-01' AND site_id IN ('22222222-2222-2222-2222-222222222222')")));
  assert.equal(commands.length, RETENTION_TABLES.length * 2);
});

test("retention cleanup falls back to the global policy when no site rows exist", async () => {
  const commands: string[] = [];
  const dbClient = {
    select() {
      return {
        from: async () => [],
      };
    },
  };
  const client = {
    async command({ query }: { query: string }) {
      commands.push(query);
    },
  };

  await runRetentionCleanup({
    client: client as never,
    dbClient: dbClient as never,
    now: new Date("2026-10-10T12:00:00.000Z"),
  });

  assert.ok(commands.some((query) => query.includes("ALTER TABLE events_raw DELETE WHERE timestamp < '2024-10-01 00:00:00'")));
  assert.ok(commands.every((query) => !query.includes("site_id = '")));
  assert.equal(commands.length, RETENTION_TABLES.length);
});

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-10-10T12:00:00.000Z");
const sitesDb = (rows: Array<{ id: string; retentionMonths: number | null }>) => ({ select: () => ({ from: async () => rows }) });

test("sites with the same retention share one statement per table", async () => {
  const commands: string[] = [];
  await runRetentionCleanup({
    client: { command: async ({ query }: { query: string }) => void commands.push(query) } as never,
    dbClient: sitesDb([{ id: A, retentionMonths: 24 }, { id: B, retentionMonths: 24 }, { id: C, retentionMonths: 12 }]) as never,
    now: NOW,
  });
  assert.equal(commands.length, RETENTION_TABLES.length * 2); // two classes, not three sites
  assert.ok(commands.some((q) => q.startsWith("ALTER TABLE events_v2 DELETE") && q.includes(`IN ('${A}', '${B}')`)));
});

test("every table the pipeline writes is covered, including events_v2 and the aggregates", () => {
  const names = RETENTION_TABLES.map((t) => t.table);
  for (const t of ["events_raw", "events_v2", "site_daily_agg", "session_day_agg", "dim_daily_agg", "filter_daily_agg", "event_daily_agg", "web_vitals_agg", "site_profiles_agg"]) {
    assert.ok(names.includes(t), t);
  }
});

test("an id that is not a UUID never reaches the statement, and an empty list deletes nothing", () => {
  const cutoff = cutoffForRetention(NOW, 6);
  const q = buildRetentionDeleteQuery("events_raw", "timestamp", "datetime", cutoff, [A, "x' OR 1=1 --"]);
  assert.ok(q.includes(A));
  assert.ok(!q.includes("OR 1=1"));
  assert.match(buildRetentionDeleteQuery("events_raw", "timestamp", "datetime", cutoff, []), /site_id IN \(\)$/);
});

test("a failing statement no longer disappears: the run still tries everything, then fails", async () => {
  const commands: string[] = [];
  const client = {
    async command({ query }: { query: string }) {
      commands.push(query);
      if (query.startsWith("ALTER TABLE events_v2")) throw new Error("too many mutations");
    },
  };
  await assert.rejects(
    runRetentionCleanup({ client: client as never, dbClient: sitesDb([{ id: A, retentionMonths: 6 }]) as never, now: NOW }),
    /1 statement\(s\) failed.*events_v2.*too many mutations/
  );
  assert.equal(commands.length, RETENTION_TABLES.length); // the other tables were still attempted
});

test("retention waits instead of piling onto a ClickHouse mutation backlog", async () => {
  const commands: string[] = [];
  const client = {
    async command({ query }: { query: string }) {
      commands.push(query);
    },
    async query() {
      return { json: async () => [{ n: "250" }] };
    },
  };
  await assert.rejects(
    runRetentionCleanup({ client: client as never, dbClient: sitesDb([{ id: A, retentionMonths: 6 }]) as never, now: NOW }),
    /250 ClickHouse mutations are still pending/
  );
  assert.equal(commands.length, 0);
});
