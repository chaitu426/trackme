import { test } from "node:test";
import assert from "node:assert/strict";
import { createClickHouseWriter, insertSettings, type InsertClient } from "./clickhouse.js";
import { DataError } from "../errors.js";

type Insert = Parameters<InsertClient["insert"]>[0];

function fakeClient(failOn?: string) {
  const inserts: Insert[] = [];
  const client: InsertClient = {
    async insert(params) {
      if (failOn === params.table) throw new Error(`${params.table} unavailable`);
      inserts.push(params);
    },
  };
  return { client, inserts };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42",
    type: "pageview",
    occurredAt: "2026-10-09T12:00:00.000Z",
    siteKey: "site_key_12345",
    sessionId: "session-1234",
    visitorPseudonym: "visitor-1234",
    url: "https://example.com/pricing",
    path: "/pricing",
    workspaceId: "0b9f6a64-0d1f-4f3a-9c55-2d4f5c0f8a11",
    siteId: "a1c2e3f4-1111-4222-8333-444455556666",
    receivedAt: "2026-10-09T12:00:00.100Z",
    device: "desktop",
    isBot: false,
    botStatus: "human",
    ...overrides,
  } as never;
}

const vital = (id: string) =>
  event({
    type: "web_vital",
    eventId: id,
    webVital: { name: "LCP", value: 1800, rating: "good", navigationType: "navigate" },
  });

const options = (client: InsertClient, asyncInsert = true) => ({ client, asyncInsert, flushIntervalMs: 1000 });

test("async insert settings wait for the flush so offsets are only resolved once rows are durable", () => {
  assert.deepEqual(insertSettings({ asyncInsert: true, flushIntervalMs: 750 }), {
    async_insert: 1,
    wait_for_async_insert: 1,
    async_insert_busy_timeout_ms: 750,
  });
  assert.equal(insertSettings({ asyncInsert: false, flushIntervalMs: 750 }), undefined);
});

test("events go to events_raw with the async settings applied", async () => {
  const { client, inserts } = fakeClient();
  await createClickHouseWriter(options(client))([event()]);

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.table, "events_raw");
  assert.equal(inserts[0]?.clickhouse_settings?.wait_for_async_insert, 1);
});

test("with async insert off no settings are sent", async () => {
  const { client, inserts } = fakeClient();
  await createClickHouseWriter(options(client, false))([event()]);
  assert.equal(inserts[0]?.clickhouse_settings, undefined);
});

test("web vitals are written with their event id so a redelivery collapses to one row", async () => {
  const { client, inserts } = fakeClient();
  const id = "9d3b8c1e-5a47-4d9e-8b21-0c6f7a1d9e99";
  await createClickHouseWriter(options(client))([event(), vital(id)]);

  const vitals = inserts.filter((i) => i.table === "web_vitals");
  assert.equal(vitals.length, 1);
  assert.equal((vitals[0]?.values[0] as { event_id: string }).event_id, id);
  assert.equal(inserts.find((i) => i.table === "events_raw")?.values.length, 2);
});

test("a batch with no web vitals does not touch web_vitals", async () => {
  const { client, inserts } = fakeClient();
  await createClickHouseWriter(options(client))([event()]);
  assert.deepEqual(inserts.map((i) => i.table), ["events_raw"]);
});

test("an empty batch inserts nothing", async () => {
  const { client, inserts } = fakeClient();
  await createClickHouseWriter(options(client))([]);
  assert.equal(inserts.length, 0);
});

test("a web_vitals failure surfaces so the batch is redelivered", async () => {
  const { client } = fakeClient("web_vitals");
  const write = createClickHouseWriter(options(client));
  await assert.rejects(write([event(), vital("9d3b8c1e-5a47-4d9e-8b21-0c6f7a1d9e99")]), /web_vitals unavailable/);
});

test("an unrepresentable timestamp is a data error, not an infrastructure error", async () => {
  const { client } = fakeClient();
  const write = createClickHouseWriter(options(client));
  await assert.rejects(write([event({ occurredAt: "garbage" })]), DataError);
});
