import assert from "node:assert/strict";
import { test } from "node:test";

import { runUsageMetering, type UsageMeteringClient, type UsageMeteringDB, type UsageMeteringRedis, USAGE_METERING_SQL } from "./usage-metering.js";

function makeClient(rows: Array<Record<string, string | number | null>>) {
  const calls: Array<{ query: string; format: "JSONEachRow"; query_params?: Record<string, unknown> }> = [];
  const client = {
    async query(params: { query: string; format: "JSONEachRow"; query_params?: Record<string, unknown> }) {
      calls.push(params);
      return {
        async json<T>() {
          return rows as T[];
        },
      };
    },
  } satisfies UsageMeteringClient;

  return { client, calls };
}

function makeDb() {
  const calls: Array<{ rows: unknown[]; target: unknown[] }> = [];
  const dbClient = {
    insert() {
      return {
        values(rows: unknown[]) {
          return {
            async onConflictDoUpdate(config: {
              target: unknown[];
              set: Record<string, unknown>;
            }) {
              calls.push({ rows, target: config.target });
              return null;
            },
          };
        },
      };
    },
  } satisfies UsageMeteringDB;

  return { dbClient, calls };
}

function makeRedis() {
  const calls: unknown[][] = [];
  const redis = {
    async eval(_script: string, _numkeys: number, ...args: unknown[]) {
      calls.push(args);
      return 1;
    },
    disconnect() {},
  } satisfies UsageMeteringRedis;

  return { redis, calls };
}

test("usage metering reads from the rollup table and upserts one aggregated row per site", async () => {
  const rows = [
    { workspace_id: "11111111-1111-1111-1111-111111111111", site_id: "22222222-2222-2222-2222-222222222222", event_count: 120 },
    { workspace_id: "11111111-1111-1111-1111-111111111111", site_id: "33333333-3333-3333-3333-333333333333", event_count: 55 },
  ];
  const { client, calls: queryCalls } = makeClient(rows);
  const { dbClient, calls: dbCalls } = makeDb();
  const { redis, calls: redisCalls } = makeRedis();

  await runUsageMetering({
    client,
    dbClient,
    redis,
    now: new Date("2026-10-10T12:00:00.000Z"),
    period: "2026-10",
  });

  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].query, USAGE_METERING_SQL);
  assert.equal(dbCalls.length, 1);
  assert.deepEqual(dbCalls[0].rows, [
    {
      workspaceId: rows[0].workspace_id,
      siteId: rows[0].site_id,
      period: "2026-10",
      eventCount: 120,
    },
    {
      workspaceId: rows[1].workspace_id,
      siteId: rows[1].site_id,
      period: "2026-10",
      eventCount: 55,
    },
  ]);
  assert.equal(redisCalls.length, 1);
  assert.deepEqual(redisCalls[0][0], `usage:11111111-1111-1111-1111-111111111111:2026-10`);
  assert.equal(redisCalls[0][1], 175);
});

test("usage metering uses the rollup table and not the raw events table", async () => {
  const { client } = makeClient([]);
  const { dbClient } = makeDb();
  const { redis, calls: redisCalls } = makeRedis();

  await runUsageMetering({
    client,
    dbClient,
    redis,
    now: new Date("2026-10-10T12:00:00.000Z"),
    period: "2026-10",
  });

  assert.equal(USAGE_METERING_SQL.includes("event_rollups_daily"), true);
  assert.equal(USAGE_METERING_SQL.includes("events_raw"), false);
  assert.equal(redisCalls.length, 0);
});
