import assert from "node:assert/strict";
import test from "node:test";
import { diffResults, dispatch, setShadowReporter, toV2Sql, type ShadowDiff } from "./read-mode.js";

test("toV2Sql points event queries at events_v2 and hashed ids", () => {
  const out = toV2Sql("SELECT uniqExact(visitor_pseudonym), session_id FROM events_raw WHERE x = 1");
  assert.equal(out, "SELECT uniqExact(visitor_hash), session_hash FROM events_v2 WHERE x = 1");
});

test("toV2Sql hashes a visitor identifier lookup and filters referrers by domain", () => {
  assert.match(toV2Sql("visitor_pseudonym = {identifier:String}"), /visitor_hash = cityHash64\(\{identifier:String\}\)/);
  assert.match(toV2Sql("AND referrer = {filter_referrer:String}"), /referrer_domain = \{filter_referrer:String\}/);
});

test("diffResults tolerates small drift and flags real differences", () => {
  assert.deepEqual(diffResults({ a: 1000 }, { a: 1010 }), []); // 1 %
  assert.equal(diffResults({ a: 1000 }, { a: 1100 }).length, 1); // 10 %
  assert.deepEqual(diffResults({ a: 1 }, { a: 3 }), []); // tiny counts are not flagged
  assert.equal(diffResults(["x"], ["x", "y"]).length, 1);
  assert.equal(diffResults({ s: "a" }, { s: "b" }).length, 1);
});

test("shadow mode returns v1, reports differences, and survives a failing v2", async () => {
  const seen: ShadowDiff[] = [];
  setShadowReporter((d) => seen.push(d));

  const same = await dispatch("q", async (v) => ({ n: 100, v }), { normalize: ({ n }) => n }, "shadow");
  assert.deepEqual(same, { n: 100, v: "v1" });
  assert.equal(seen.length, 0);

  await dispatch("q", async (v) => (v === "v1" ? 100 : 500), {}, "shadow");
  assert.equal(seen.length, 1);

  const result = await dispatch(
    "q",
    async (v) => {
      if (v === "v2") throw new Error("table missing");
      return "ok";
    },
    {},
    "shadow"
  );
  assert.equal(result, "ok");
  assert.match(seen[1]!.differences[0]!, /v2 failed/);
});

test("v1 and v2 modes run only that variant", async () => {
  const ran: string[] = [];
  await dispatch("q", async (v) => ran.push(v), {}, "v2");
  await dispatch("q", async (v) => ran.push(v), {}, "v1");
  assert.deepEqual(ran, ["v2", "v1"]);
});
