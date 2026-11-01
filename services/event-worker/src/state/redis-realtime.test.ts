import { test } from "node:test";
import assert from "node:assert/strict";
import { latestPerSession, queueRealtimeCommands, type RealtimePipeline } from "./redis-realtime.js";

function recorder() {
  const calls: string[] = [];
  const pipeline: RealtimePipeline = {
    set: (k) => calls.push(`set ${k}`),
    zadd: (k, ...a) => calls.push(`zadd ${k} ${a.join(",")}`),
    zremrangebyscore: (k) => calls.push(`zrem ${k}`),
    expire: (k) => calls.push(`expire ${k}`),
    publish: (c) => calls.push(`publish ${c}`),
  };
  return { calls, pipeline };
}

const ev = (siteId: string, sessionId: string, occurredAt: string, isBot = false) => ({
  siteId, sessionId, occurredAt, path: "/", country: "US", device: "desktop", isBot,
});

test("a batch of many events for one session costs one SET plus four site commands", () => {
  const { calls, pipeline } = recorder();
  const events = Array.from({ length: 100 }, (_, i) => ev("s1", "a", `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`));
  queueRealtimeCommands(pipeline, events, 1000);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((c) => c.startsWith("publish")).length, 1);
});

test("the newest event wins regardless of arrival order", () => {
  const map = latestPerSession([
    ev("s1", "a", "2026-01-01T00:00:05.000Z"),
    ev("s1", "a", "2026-01-01T00:00:01.000Z"),
  ]);
  assert.equal(map.get("s1")!.get("a")!.occurredAt, "2026-01-01T00:00:05.000Z");
});

test("bots produce no commands and no notification", () => {
  const { calls, pipeline } = recorder();
  queueRealtimeCommands(pipeline, [ev("s1", "a", "2026-01-01T00:00:00.000Z", true)], 1000);
  assert.deepEqual(calls, []);
});

test("sessions are batched into one multi-member ZADD per site", () => {
  const { calls, pipeline } = recorder();
  queueRealtimeCommands(pipeline, [ev("s1", "a", "2026-01-01T00:00:00.000Z"), ev("s1", "b", "2026-01-01T00:00:00.000Z"), ev("s2", "c", "2026-01-01T00:00:00.000Z")], 1000);
  assert.deepEqual(calls.filter((c) => c.startsWith("zadd")), ["zadd rt:active:s1 1300,a,1300,b", "zadd rt:active:s2 1300,c"]);
});
