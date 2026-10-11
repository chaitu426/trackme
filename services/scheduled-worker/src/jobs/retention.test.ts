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
  const query = buildRetentionDeleteQuery("events_raw", "timestamp", "datetime", cutoff, "11111111-1111-1111-1111-111111111111");

  assert.match(query, /ALTER TABLE events_raw DELETE WHERE timestamp < '2026-04-01 00:00:00' AND site_id = '11111111-1111-1111-1111-111111111111'/);
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

  assert.ok(commands.some((query) => query.includes("ALTER TABLE events_raw DELETE WHERE timestamp < '2026-04-01 00:00:00' AND site_id = '11111111-1111-1111-1111-111111111111'")));
  assert.ok(commands.some((query) => query.includes("ALTER TABLE pageview_rollups_daily DELETE WHERE date < '2025-10-01' AND site_id = '22222222-2222-2222-2222-222222222222'")));
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
