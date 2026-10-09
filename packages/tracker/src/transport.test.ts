import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Transport, classifyStatus } from "./transport.js";

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

let store: Map<string, string>;
let timers: { id: number; fn: () => void; ms: number }[];
let listeners: Record<string, (() => void)[]>;
let fetchCalls: Call[];
let beacons: { url: string; body: Blob }[];
let statuses: (number | "network")[];
let beaconResult: boolean;
let visibility: string;

beforeEach(() => {
  store = new Map();
  timers = [];
  listeners = {};
  fetchCalls = [];
  beacons = [];
  statuses = [];
  beaconResult = true;
  visibility = "visible";
  let nextId = 1;

  const win = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", win);
  define("document", {
    get visibilityState() {
      return visibility;
    },
  });
  define("navigator", {
    sendBeacon: (url: string, body: Blob) => {
      beacons.push({ url, body });
      return beaconResult;
    },
  });
  define("fetch", async (url: string, init: Call["init"]) => {
    fetchCalls.push({ url, init });
    const next = statuses.shift() ?? 202;
    if (next === "network") throw new TypeError("Failed to fetch");
    return { status: next, ok: next >= 200 && next < 300 };
  });
});

let counter = 0;
function event(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const hex = counter.toString(16).padStart(12, "0");
  return {
    schemaVersion: 1,
    eventId: `3f2b8c1e-5a47-4d9e-8b21-${hex}`,
    type: "pageview",
    occurredAt: new Date().toISOString(),
    siteKey: "site_key_12345",
    sessionId: "session-1234",
    visitorPseudonym: "visitor-1234",
    url: "https://example.com/",
    path: "/",
    ...overrides,
  } as never;
}

const sentEvents = (call: Call) => (JSON.parse(call.init.body) as { events: unknown[] }).events;
const queued = () => JSON.parse(store.get("_gi_retry_queue") ?? "[]") as { event: { eventId: string }; attempts: number }[];
const fire = (type: string) => listeners[type]?.forEach((fn) => fn());
const make = (opts: Partial<ConstructorParameters<typeof Transport>[0]> = {}) =>
  new Transport({ endpoint: "https://edge.test/v1/batch", flushIntervalMs: 500, ...opts });

test("classifyStatus retries only failures that can clear up", () => {
  for (const s of [200, 202]) assert.equal(classifyStatus(s), "sent");
  for (const s of [408, 429, 500, 502, 503]) assert.equal(classifyStatus(s), "retry");
  for (const s of [400, 401, 402, 403, 404, 413]) assert.equal(classifyStatus(s), "drop");
});

test("a large buffer is split into requests the edge accepts", async () => {
  const t = make({ batchSize: 1000 });
  for (let i = 0; i < 120; i++) t.enqueue(event());
  await t.flush();

  assert.deepEqual(fetchCalls.map((c) => sentEvents(c).length), [50, 50, 20]);
});

test("requests stay under the byte budget even when events are large", async () => {
  const t = make({ batchSize: 1000 });
  for (let i = 0; i < 20; i++) t.enqueue(event({ title: "x".repeat(400), referrer: "https://r.test/" + "y".repeat(1500) }));
  await t.flush();

  assert.ok(fetchCalls.length > 1, "expected the buffer to be split by size");
  for (const c of fetchCalls) assert.ok(new TextEncoder().encode(c.init.body).length <= 30_000);
  assert.equal(fetchCalls.reduce((n, c) => n + sentEvents(c).length, 0), 20);
});

test("an event too large to ever send is dropped without blocking the rest", async () => {
  const t = make({ batchSize: 1000 });
  t.enqueue(event());
  t.enqueue(event({ title: "z".repeat(40_000) }));
  t.enqueue(event());
  await t.flush();

  assert.equal(fetchCalls.reduce((n, c) => n + sentEvents(c).length, 0), 2);
});

test("a 400 response drops the batch and does not queue it for retry", async () => {
  statuses = [400];
  const t = make({ batchSize: 1 });
  t.enqueue(event());
  await t.flush();

  assert.equal(queued().length, 0);
  assert.equal(timers.length, 0, "no retry should be scheduled for a permanent error");
});

for (const status of [401, 402, 403]) {
  test(`a ${status} response is not retried`, async () => {
    statuses = [status];
    const t = make({ batchSize: 1 });
    t.enqueue(event());
    await t.flush();
    assert.equal(queued().length, 0);
  });
}

test("a 500 response queues the batch, counts the attempt and schedules a retry", async () => {
  statuses = [500];
  const t = make({ batchSize: 1 });
  t.enqueue(event());
  await t.flush();

  assert.equal(queued().length, 1);
  assert.equal(queued()[0]?.attempts, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.ms, 5_000);
});

test("the retry timer resends the queued events and clears the queue on success", async () => {
  statuses = [503, 202];
  const t = make({ batchSize: 1 });
  const e = event();
  t.enqueue(e);
  await t.flush();
  assert.equal(queued().length, 1);

  timers[0]?.fn();
  await t.flush();

  assert.equal(fetchCalls.length, 2);
  assert.equal(queued().length, 0);
  assert.equal(sentEvents(fetchCalls[1] as Call).length, 1);
});

test("a network error is retried like a 5xx", async () => {
  statuses = ["network"];
  const t = make({ batchSize: 1 });
  t.enqueue(event());
  await t.flush();
  assert.equal(queued().length, 1);
});

test("retry backoff grows after consecutive failures", async () => {
  statuses = [500, 500, 500];
  const t = make({ batchSize: 1 });
  t.enqueue(event());
  await t.flush();
  assert.equal(timers[0]?.ms, 5_000);
  timers.shift()?.fn();
  await t.flush();
  assert.equal(timers[0]?.ms, 15_000);
  timers.shift()?.fn();
  await t.flush();
  assert.equal(timers[0]?.ms, 45_000);
});

test("an event is dropped after five failed attempts", async () => {
  statuses = [500, 500, 500, 500, 500];
  const t = make({ batchSize: 1 });
  t.enqueue(event());
  await t.flush();
  for (let i = 0; i < 4; i++) {
    timers.shift()?.fn();
    await t.flush();
  }
  assert.equal(fetchCalls.length, 5);
  assert.equal(queued().length, 0, "exhausted events must leave the queue");
  assert.equal(timers.length, 0);
});

test("events older than 23 hours are dropped when the queue is replayed", async () => {
  const old = event({ occurredAt: new Date(Date.now() - 24 * 3600_000).toISOString() });
  const fresh = event();
  store.set("_gi_retry_queue", JSON.stringify([
    { event: old, attempts: 1 },
    { event: fresh, attempts: 1 },
  ]));
  const t = make();
  await t.flush();

  const ids = fetchCalls.flatMap(sentEvents).map((e) => (e as { eventId: string }).eventId);
  assert.deepEqual(ids, [(fresh as { eventId: string }).eventId]);
});

test("a queue written by an earlier SDK version (bare events) is still replayed", async () => {
  const legacy = event();
  store.set("_gi_retry_queue", JSON.stringify([legacy]));
  const t = make();
  await t.flush();
  assert.equal(fetchCalls.flatMap(sentEvents).length, 1);
  assert.equal(queued().length, 0);
});

test("an oversized stored queue drains in valid requests instead of failing forever", async () => {
  const entries = Array.from({ length: 100 }, () => ({ event: event(), attempts: 0 }));
  store.set("_gi_retry_queue", JSON.stringify(entries));
  const t = make();
  await t.flush();
  assert.deepEqual(fetchCalls.map((c) => sentEvents(c).length), [50, 50]);
  assert.equal(queued().length, 0);
});

test("events enqueued while a request is in flight are sent afterwards", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const original = globalThis.fetch;
  let first = true;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (url: string, init: Call["init"]) => {
      if (first) {
        first = false;
        await gate;
      }
      return original(url, init as never);
    },
  });

  const t = make({ batchSize: 1 });
  t.enqueue(event());
  const inFlight = t.flush();
  t.enqueue(event());
  t.enqueue(event());
  release();
  await inFlight;

  assert.equal(fetchCalls.flatMap(sentEvents).length, 3);
});

test("requests with no custom headers use text/plain so the browser skips the preflight", async () => {
  const t = make({ batchSize: 1 });
  t.enqueue(event());
  await t.flush();
  assert.equal(fetchCalls[0]?.init.headers["Content-Type"], "text/plain;charset=UTF-8");
});

test("granted consent adds the consent header and uses application/json", async () => {
  const t = make({ batchSize: 1, consent: "granted" });
  t.enqueue(event());
  await t.flush();
  const headers = fetchCalls[0]?.init.headers;
  assert.equal(headers?.["X-GI-Consent"], "granted");
  assert.equal(headers?.["Content-Type"], "application/json");
});

test("denying consent discards buffered and queued events and ignores new ones", async () => {
  store.set("_gi_retry_queue", JSON.stringify([{ event: event(), attempts: 0 }]));
  const t = make({ batchSize: 1000, consent: "granted" });
  t.enqueue(event());
  t.setConsent("denied");
  t.enqueue(event());
  await t.flush();

  assert.equal(fetchCalls.length, 0);
  assert.equal(queued().length, 0);
});

test("a stored denial discards the retry queue on startup", async () => {
  store.set("_gi_retry_queue", JSON.stringify([{ event: event(), attempts: 0 }]));
  const t = make({ consent: "denied" });
  await t.flush();
  assert.equal(fetchCalls.length, 0);
  assert.equal(queued().length, 0);
});

test("with requireConsent the retry queue is held until consent is granted", async () => {
  store.set("_gi_retry_queue", JSON.stringify([{ event: event(), attempts: 0 }]));
  const t = make({ requireConsent: true });
  await t.flush();
  assert.equal(fetchCalls.length, 0);
  assert.equal(queued().length, 1, "events must stay stored, not be sent or lost");

  t.setConsent("granted");
  await t.flush();
  assert.equal(fetchCalls.flatMap(sentEvents).length, 1);
  assert.equal(queued().length, 0);
});

test("hiding the page sends buffered events with a beacon", async () => {
  const t = make({ batchSize: 1000 });
  t.enqueue(event());
  t.enqueue(event());
  visibility = "hidden";
  fire("visibilitychange");

  assert.equal(beacons.length, 1);
  assert.equal(fetchCalls.length, 0);
  const text = await beacons[0]?.body.text();
  assert.equal((JSON.parse(text ?? "{}") as { events: unknown[] }).events.length, 2);
  assert.equal(beacons[0]?.body.type.toLowerCase(), "text/plain;charset=utf-8");
});

test("hiding the page with consent granted uses fetch keepalive because beacons cannot carry the header", () => {
  const t = make({ batchSize: 1000, consent: "granted" });
  t.enqueue(event());
  fire("pagehide");

  assert.equal(beacons.length, 0);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.init.headers["X-GI-Consent"], "granted");
});

test("hiding the page with signing configured stores events instead of racing an async HMAC", () => {
  const t = make({ batchSize: 1000, signingSecret: "gis_secret" });
  t.enqueue(event());
  t.enqueue(event());
  fire("pagehide");

  assert.equal(beacons.length, 0);
  assert.equal(fetchCalls.length, 0);
  assert.equal(queued().length, 2);
  assert.equal(queued()[0]?.attempts, 0, "a page hide is not a failed attempt");
});

test("a pagehide while a request is in flight still sends the remaining events", async () => {
  const t = make({ batchSize: 1 });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (url: string, init: Call["init"]) => {
      await gate;
      return original(url, init as never);
    },
  });

  t.enqueue(event());
  const inFlight = t.flush();
  t.enqueue(event());
  fire("pagehide");
  release();
  await inFlight;

  assert.equal(beacons.length, 1, "the second event must go out with the page hide");
});

test("a failed beacon falls back to fetch keepalive", () => {
  beaconResult = false;
  const t = make({ batchSize: 1000 });
  t.enqueue(event());
  fire("pagehide");
  assert.equal(fetchCalls.length, 1);
});
