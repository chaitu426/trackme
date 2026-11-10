import { test } from "node:test";
import assert from "node:assert/strict";
import { createFailureLimiter, createThrottle, createTtlCache } from "./webhook-guard";

test("a caller is blocked after too many failures, and unblocked when the window ends", () => {
  let t = 0;
  const l = createFailureLimiter(3, 60_000, () => t);
  for (let i = 0; i < 2; i += 1) l.recordFailure("ip");
  assert.equal(l.isBlocked("ip"), false);
  l.recordFailure("ip");
  assert.equal(l.isBlocked("ip"), true);
  assert.equal(l.isBlocked("other"), false);
  t = 60_001;
  assert.equal(l.isBlocked("ip"), false);
});

test("the cache returns a value until it expires", () => {
  let t = 0;
  const c = createTtlCache<string>(1000, () => t);
  c.set("a", "x");
  assert.equal(c.get("a"), "x");
  t = 1001;
  assert.equal(c.get("a"), undefined);
});

test("cached entries can be removed by what they hold", () => {
  const c = createTtlCache<{ siteId: string }>(1000);
  c.set("a", { siteId: "1" });
  c.set("b", { siteId: "2" });
  c.deleteWhere((v) => v.siteId === "1");
  assert.equal(c.get("a"), undefined);
  assert.deepEqual(c.get("b"), { siteId: "2" });
});

test("the throttle lets a key through once per interval", () => {
  let t = 0;
  const allow = createThrottle(60_000, () => t);
  assert.equal(allow("k"), true);
  assert.equal(allow("k"), false);
  assert.equal(allow("other"), true);
  t = 60_000;
  assert.equal(allow("k"), true);
});
