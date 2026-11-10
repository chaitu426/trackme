import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSegment, type SegmentDeps } from "./segments";
import { EMPTY_SEGMENT } from "./segment-schema";

const WS = "11111111-1111-1111-1111-111111111111";
const SITE = "22222222-2222-2222-2222-222222222222";
const profile = (id: string) => ({ id, distinctId: id }) as never;

function deps(ids: string[], didIds: string[] = []): SegmentDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    findProfiles: (async (q: { limit: number }) => (calls.push(q), ids.slice(0, q.limit).map(profile))) as never,
    getDistinctIdsWithBehavior: (async (q: unknown) => (calls.push(q), didIds)) as never,
  };
}

test("everyone matching the profile conditions is returned, up to the cap", async () => {
  const d = deps(["a", "b", "c"]);
  const out = await matchSegment(WS, SITE, EMPTY_SEGMENT, 10, d);
  assert.deepEqual(out.rows.map((r) => r.distinctId), ["a", "b", "c"]);
  assert.equal(out.capped, false);
});

test("hitting the cap is reported, so the match is known to be incomplete", async () => {
  const out = await matchSegment(WS, SITE, EMPTY_SEGMENT, 2, deps(["a", "b", "c"]));
  assert.equal(out.rows.length, 2);
  assert.equal(out.capped, true);
});

test("behaviour conditions keep people who did it, or drop them for did-not", async () => {
  const did = { match: "all" as const, conditions: [], behavior: [{ op: "did" as const, kind: "custom_event" as const, target: "buy", days: 30 }] };
  const didNot = { ...did, behavior: [{ ...did.behavior[0]!, op: "did_not" as const }] };
  const d = deps(["a", "b", "c"], ["b"]);
  assert.deepEqual((await matchSegment(WS, SITE, did, 10, d)).rows.map((r) => r.distinctId), ["b"]);
  assert.deepEqual((await matchSegment(WS, SITE, didNot, 10, d)).rows.map((r) => r.distinctId), ["a", "c"]);
});

test("no candidates means no behaviour query", async () => {
  const d = deps([]);
  await matchSegment(WS, SITE, { match: "all", conditions: [], behavior: [{ op: "did", kind: "custom_event", target: "x", days: 7 }] }, 10, d);
  assert.equal(d.calls.length, 1);
});
