import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedMembershipRole,
  cachedSiteInWorkspace,
  invalidateMembership,
  membershipKey,
} from "./authz-cache";

function store() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k: string) => data.get(k) ?? null,
    set: async (k: string, v: string) => void data.set(k, v),
    del: async (...ks: string[]) => void ks.forEach((k) => data.delete(k)),
  };
}

test("membership is loaded once, then served from cache", async () => {
  const s = store();
  let loads = 0;
  const load = async () => (++loads, "admin");
  assert.equal(await cachedMembershipRole("u", "w", load, s), "admin");
  assert.equal(await cachedMembershipRole("u", "w", load, s), "admin");
  assert.equal(loads, 1);
});

test("a removed member is rejected on the very next call after invalidation", async () => {
  const s = store();
  await cachedMembershipRole("u", "w", async () => "viewer", s);
  await invalidateMembership("u", "w", s);
  await assert.rejects(
    cachedMembershipRole("u", "w", async () => {
      throw new Error("not a member");
    }, s)
  );
});

test("a failed load is never cached", async () => {
  const s = store();
  await assert.rejects(cachedMembershipRole("u", "w", async () => { throw new Error("no"); }, s));
  assert.equal(s.data.has(membershipKey("u", "w")), false);
});

test("cache outage falls back to the database", async () => {
  const broken = {
    get: async () => { throw new Error("down"); },
    set: async () => { throw new Error("down"); },
    del: async () => { throw new Error("down"); },
  };
  assert.equal(await cachedMembershipRole("u", "w", async () => "owner", broken), "owner");
  assert.equal(await cachedSiteInWorkspace("s", "w", async () => true, broken), true);
  await invalidateMembership("u", "w", broken); // must not throw
});

test("a site cached for one workspace does not authorize another", async () => {
  const s = store();
  assert.equal(await cachedSiteInWorkspace("site", "ws-a", async () => true, s), true);
  assert.equal(await cachedSiteInWorkspace("site", "ws-b", async () => { throw new Error("must not reload"); }, s), false);
});

test("negative site results are not cached, so a newly created site works immediately", async () => {
  const s = store();
  assert.equal(await cachedSiteInWorkspace("site", "ws", async () => false, s), false);
  assert.equal(await cachedSiteInWorkspace("site", "ws", async () => true, s), true);
});
