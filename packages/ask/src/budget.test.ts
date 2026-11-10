import { test } from "node:test";
import assert from "node:assert/strict";
import { takeRpmToken, acquireWorkspaceSlot, inFlight, limiterStatus, type BudgetRedis } from "./budget.js";

/** A fake Redis that recognises the two scripts by a distinctive token and applies their effect in JS. */
class FakeRedis implements BudgetRedis {
  bucket = { tokens: -1, ts: 0 };
  slots = new Map<string, number>();
  async eval(script: string, _numKeys: number, ...args: Array<string | number>): Promise<number> {
    if (script.includes("HGET")) {
      // The read-only peek: [key, capacity]; a full bucket before its first write.
      return this.bucket.tokens === -1 ? Number(args[1]) : this.bucket.tokens;
    }
    if (script.includes("HMGET")) {
      // args: [key, capacity, window_ms, now]
      const capacity = Number(args[1]);
      const now = Number(args[3]);
      if (this.bucket.tokens === -1) this.bucket = { tokens: capacity, ts: now };
      const refill = Math.floor(((now - this.bucket.ts) / 60_000) * capacity);
      if (refill > 0) {
        this.bucket.tokens = Math.min(capacity, this.bucket.tokens + refill);
        this.bucket.ts = now;
      }
      if (this.bucket.tokens < 1) return 0;
      this.bucket.tokens -= 1;
      return 1;
    }
    if (script.includes("INCR")) {
      const key = String(args[0]);
      const limit = Number(args[1]);
      const n = (this.slots.get(key) ?? 0) + 1;
      if (n > limit) return 0;
      this.slots.set(key, n);
      return 1;
    }
    if (script.includes("DECR")) {
      const key = String(args[0]);
      this.slots.set(key, (this.slots.get(key) ?? 0) - 1);
      return 0;
    }
    return 0;
  }
  async get(key: string): Promise<string | null> {
    return String(this.slots.get(key) ?? 0);
  }
}

test("the RPM bucket allows exactly its capacity in one minute, then blocks", async () => {
  const redis = new FakeRedis();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(await takeRpmToken(redis, 3, now), true);
  assert.equal(await takeRpmToken(redis, 3, now), false);
  // A minute later the bucket refills.
  assert.equal(await takeRpmToken(redis, 3, now + 60_000), true);
});

test("a workspace may hold its slot limit, and releasing frees one", async () => {
  const redis = new FakeRedis();
  const a = await acquireWorkspaceSlot(redis, "ws1", 2);
  const b = await acquireWorkspaceSlot(redis, "ws1", 2);
  assert.ok(a && b);
  assert.equal(await acquireWorkspaceSlot(redis, "ws1", 2), null);
  assert.equal(await inFlight(redis, "ws1"), 2);
  await a!();
  await a!(); // releasing twice is a no-op
  assert.equal(await inFlight(redis, "ws1"), 1);
  assert.ok(await acquireWorkspaceSlot(redis, "ws1", 2));
});

test("the pre-check refuses a full workspace or a spent minute, and spends nothing itself", async () => {
  const redis = new FakeRedis();
  assert.deepEqual(await limiterStatus(redis, "ws1", { capacity: 5, workspaceLimit: 1 }), { ok: true });
  const slot = await acquireWorkspaceSlot(redis, "ws1", 1);
  assert.deepEqual(await limiterStatus(redis, "ws1", { capacity: 5, workspaceLimit: 1 }), { ok: false, reason: "workspace" });
  await slot!();
  // The bucket is untouched by the checks: taking all five tokens leaves the sixth refusal.
  for (let i = 0; i < 5; i += 1) assert.equal(await takeRpmToken(redis, 5, 1_000), true);
  assert.deepEqual(await limiterStatus(redis, "ws1", { capacity: 5, workspaceLimit: 1 }), { ok: false, reason: "global" });
});
