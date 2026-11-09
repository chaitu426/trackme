import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnrichedEvent } from "@trackme/contracts";
import { prepareErrorEvents } from "./prepare.js";
import { createErrorWriter, OCCURRENCES_PER_GROUP_PER_DAY, type CounterRedis } from "./writer.js";
import type { InsertClient } from "../writers/clickhouse.js";

const SITE = "a1c2e3f4-1111-4222-8333-444455556666";

function event(overrides: Record<string, unknown> = {}): EnrichedEvent {
  return {
    schemaVersion: 1,
    eventId: "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42",
    type: "error",
    occurredAt: "2026-10-09T12:00:00.000Z",
    siteKey: "site_key_12345",
    sessionId: "session-1234",
    visitorPseudonym: "visitor-1234",
    url: "https://shop.test/pay",
    path: "/pay",
    release: "web@1.4.2",
    environment: "production",
    error: {
      type: "TypeError",
      message: "Cannot read properties of undefined (reading 'id') for ada@example.com",
      frames: [{ fn: "pay", file: "https://shop.test/app.3f2a9c1b.js?token=abc", line: 4, inApp: true }],
      breadcrumbs: [{ ts: 1, k: "fetch", m: "POST /api/pay?card=4242424242424242 500" }],
      tags: { plan: "pro" },
    },
    workspaceId: "0b9f6a64-0d1f-4f3a-9c55-2d4f5c0f8a11",
    siteId: SITE,
    receivedAt: "2026-10-09T12:00:00.100Z",
    browser: "Chrome",
    os: "Windows",
    country: "IN",
    device: "desktop",
    isBot: false,
    botStatus: "human",
    ...overrides,
  } as EnrichedEvent;
}

test("an error event gets its group and scrubbed detail; other events pass through", () => {
  const pageview = event({ type: "pageview", error: undefined });
  const out = prepareErrorEvents([event(), pageview]);

  assert.equal(out.events.length, 2);
  assert.equal(out.events[1], pageview);
  assert.match(String(out.events[0]!.properties?.groupId), /^\d+$/);
  assert.equal(out.events[0]!.properties?.errorType, "TypeError");

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]!.title, "TypeError: Cannot read properties of undefined (reading 'id') for [email]");
  assert.equal(out.rows[0]!.release, "web@1.4.2");
  assert.equal(out.rows[0]!.ts, "2026-10-09 12:00:00.000");

  const occurrence = out.occurrences[0]!;
  assert.ok(!occurrence.stack.includes("token=abc"), "query values are scrubbed from stack files");
  assert.ok(!occurrence.breadcrumbs.includes("4242424242424242"), "card numbers never reach storage");
  assert.equal(JSON.parse(occurrence.tags).plan, "pro");
});

test("the same bug twice has the same group id", () => {
  const out = prepareErrorEvents([event(), event({ eventId: "4f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42" })]);
  assert.equal(out.rows[0]!.group_id, out.rows[1]!.group_id);
});

test("a bot's error keeps its event but produces no error rows", () => {
  const out = prepareErrorEvents([event({ botStatus: "known_bot" })]);
  assert.equal(out.events.length, 1);
  assert.equal(out.rows.length, 0);
  assert.equal(out.occurrences.length, 0);
});

test("release and environment default to empty and production", () => {
  const out = prepareErrorEvents([event({ release: undefined, environment: undefined })]);
  assert.equal(out.rows[0]!.release, "");
  assert.equal(out.rows[0]!.environment, "production");
});

function fakes(startCount = 0) {
  const inserts: { table: string; values: unknown[] }[] = [];
  const client: InsertClient = { async insert(p) { inserts.push({ table: p.table, values: p.values }); } };
  const counts = new Map<string, number>();
  let fail = false;
  const redis: CounterRedis = {
    pipeline() {
      const ops: string[] = [];
      const api = {
        incr(key: string) { ops.push(key); return api; },
        expire() { ops.push(""); return api; },
        async exec() {
          if (fail) throw new Error("redis down");
          return ops.map((key) => {
            if (!key) return [null, 1] as [Error | null, unknown];
            const next = (counts.get(key) ?? startCount) + 1;
            counts.set(key, next);
            return [null, next] as [Error | null, unknown];
          });
        },
      };
      return api;
    },
  };
  return { client, redis, inserts, setFail: (v: boolean) => { fail = v; } };
}

test("every error is counted but only the first five per issue per day keep detail", async () => {
  const { client, redis, inserts } = fakes();
  const write = createErrorWriter({ client, redis });
  const events = Array.from({ length: 8 }, (_, i) => event({ eventId: `3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e4${i}` }));
  const kept = await write(prepareErrorEvents(events));

  assert.equal(kept, OCCURRENCES_PER_GROUP_PER_DAY);
  assert.equal(inserts.find((i) => i.table === "error_ingest")!.values.length, 8);
  assert.equal(inserts.find((i) => i.table === "error_occurrences")!.values.length, 5);
});

test("the daily quota carries over between batches", async () => {
  const { client, redis, inserts } = fakes();
  const write = createErrorWriter({ client, redis });
  await write(prepareErrorEvents(Array.from({ length: 4 }, (_, i) => event({ eventId: `3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e5${i}` }))));
  const kept = await write(prepareErrorEvents(Array.from({ length: 4 }, (_, i) => event({ eventId: `3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e6${i}` }))));
  assert.equal(kept, 1);
  assert.equal(inserts.filter((i) => i.table === "error_occurrences").length, 2);
});

test("an unreachable sampler stores the counts and skips the detail", async () => {
  const { client, redis, inserts, setFail } = fakes();
  setFail(true);
  let reported = 0;
  const write = createErrorWriter({ client, redis, onSamplerError: () => { reported += 1; } });
  const kept = await write(prepareErrorEvents([event()]));
  assert.equal(kept, 0);
  assert.equal(reported, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]!.table, "error_ingest");
});

test("an empty batch writes nothing", async () => {
  const { client, redis, inserts } = fakes();
  await createErrorWriter({ client, redis })(prepareErrorEvents([]));
  assert.equal(inserts.length, 0);
});
