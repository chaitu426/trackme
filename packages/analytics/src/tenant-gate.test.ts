import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalyticsOverloadedError, AnalyticsQueryError } from "./errors.js";
import { createTenantGate, tenantOf } from "./tenant-gate.js";

/** A task that stays "running" until released, and records the peak number running at once. */
function harness() {
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const task = () => async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running--;
  };
  return { task, peak: () => peak, running: () => running, releaseOne: () => releases.shift()!() };
}

const tick = () => new Promise((r) => setImmediate(r));

test("a tenant never runs more than the limit at once, and the rest run in order as slots free up", async () => {
  const run = createTenantGate(2, 10, 1000);
  const h = harness();
  const order: number[] = [];
  const jobs = [1, 2, 3, 4].map((n) =>
    run("ws", async () => {
      order.push(n);
      return h.task()();
    })
  );
  await tick();
  assert.equal(h.running(), 2);
  h.releaseOne();
  await tick();
  assert.equal(h.running(), 2); // the freed slot went straight to the next waiter
  h.releaseOne();
  h.releaseOne();
  await tick();
  h.releaseOne();
  await Promise.all(jobs);
  assert.deepEqual(order, [1, 2, 3, 4]);
  assert.equal(h.peak(), 2);
});

test("one tenant's backlog does not slow another tenant", async () => {
  const run = createTenantGate(1, 10, 1000);
  const busy = harness();
  const blocked = run("noisy", busy.task());
  const queued = run("noisy", async () => "later");
  await tick();
  assert.equal(await run("quiet", async () => "done"), "done"); // not stuck behind noisy's queue
  busy.releaseOne();
  await blocked;
  assert.equal(await queued, "later");
});

test("a full queue is refused at once, and a wait that outlasts its timeout is refused", async () => {
  const run = createTenantGate(1, 1, 30);
  const h = harness();
  const first = run("ws", h.task());
  const waiter = run("ws", async () => "never");
  await tick();
  await assert.rejects(run("ws", async () => "x"), AnalyticsOverloadedError); // queue of 1 is full
  await assert.rejects(waiter, AnalyticsOverloadedError); // its 30 ms wait expires
  h.releaseOne();
  await first;
  assert.equal(await run("ws", async () => "ok"), "ok"); // the gate is healthy afterwards
});

test("a failing query still frees its slot", async () => {
  const run = createTenantGate(1, 5, 1000);
  await assert.rejects(run("ws", async () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await run("ws", async () => "next"), "next");
});

test("overload is an AnalyticsQueryError, so existing catch blocks rethrow it unchanged", () => {
  assert.ok(new AnalyticsOverloadedError() instanceof AnalyticsQueryError);
});

test("the tenant is the bound workspaceId, with one shared lane when there is none", () => {
  assert.equal(tenantOf({ query_params: { workspaceId: "abc" } }), "abc");
  assert.equal(tenantOf({}), "_none");
});
