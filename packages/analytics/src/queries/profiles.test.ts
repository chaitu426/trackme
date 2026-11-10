import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProfileHaving, conditionSql, findProfiles, getProfile, listProfiles, profileStats, toProfile, type ProfileFilter } from "./profiles.js";

const W = "11111111-1111-1111-1111-111111111111";
const S = "22222222-2222-2222-2222-222222222222";

function fake(rows: unknown[]) {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const client = {
    async query({ query, query_params }: { query: string; query_params: Record<string, unknown> }) {
      calls.push({ query, params: query_params });
      return { json: async () => rows };
    },
  };
  return { client: client as never, calls };
}

const raw = (over: Record<string, unknown> = {}) => ({
  distinct_id: "u1",
  first_seen_at: "2026-10-01T00:00:00Z",
  last_seen_at: "2026-10-09T00:00:00Z",
  total_events: "12",
  total_sessions: "3",
  traits: JSON.stringify({ eventName: "$identify", distinctId: "u1", name: "Ada", email: "ada@example.com", plan: "pro" }),
  ...over,
});

test("a row becomes a profile: counts are numbers, name and email come from traits, internal keys are hidden", () => {
  const p = toProfile(raw());
  assert.equal(p.id, "u1");
  assert.equal(p.name, "Ada");
  assert.equal(p.email, "ada@example.com");
  assert.deepEqual(p.traits, { name: "Ada", email: "ada@example.com", plan: "pro" });
  assert.equal(p.totalEvents, 12);
  assert.equal(p.totalSessions, 3);
});

test("an empty or malformed traits blob still yields a profile", () => {
  assert.deepEqual(toProfile(raw({ traits: "" })).traits, {});
  assert.deepEqual(toProfile(raw({ traits: "{not json" })).traits, {});
  assert.deepEqual(toProfile(raw({ traits: "[1,2]" })).traits, {});
  assert.equal(toProfile(raw({ traits: "{}" })).name, null);
});

test("trait conditions compare the raw JSON value as text, so numbers and booleans work", () => {
  const params: Record<string, unknown> = {};
  const eq = conditionSql({ field: "trait", key: "plan", op: "eq", value: "pro" }, 0, params);
  assert.match(eq, /JSONHas\(tr, \{p0k:String\}\) AND trim\(BOTH '"' FROM JSONExtractRaw\(tr, \{p0k:String\}\)\) = \{p0v:String\}/);
  assert.deepEqual(params, { p0k: "plan", p0v: "pro" });
});

test("neq also matches people who do not have the trait at all (IS DISTINCT FROM semantics)", () => {
  const sql = conditionSql({ field: "trait", key: "plan", op: "neq", value: "pro" }, 0, {});
  assert.match(sql, /NOT JSONHas\(tr, \{p0k:String\}\) OR /);
});

test("numeric comparisons bind a number, and a non-numeric operand matches nobody", () => {
  const params: Record<string, unknown> = {};
  assert.match(conditionSql({ field: "trait", key: "age", op: "gt", value: "30" }, 1, params), /toFloat64OrNull\(.*\) > \{p1n:Float64\}/);
  assert.equal(params.p1n, 30);
  assert.equal(conditionSql({ field: "trait", key: "age", op: "lt", value: "abc" }, 2, {}), "0");
});

test("seen-in-the-last-N-days, session and event counts, and email conditions", () => {
  const params: Record<string, unknown> = {};
  assert.equal(conditionSql({ field: "lastSeen", op: "within", days: 7 }, 0, params), "ls >= now() - toIntervalDay({p0d:UInt16})");
  assert.equal(conditionSql({ field: "firstSeen", op: "before", days: 30 }, 1, params), "fs < now() - toIntervalDay({p1d:UInt16})");
  assert.equal(conditionSql({ field: "sessions", op: "gte", value: 3 }, 2, params), "ss >= {p2n:UInt64}");
  assert.equal(conditionSql({ field: "events", op: "lte", value: 9 }, 3, params), "ev <= {p3n:UInt64}");
  assert.equal(conditionSql({ field: "email", op: "exists" }, 4, params), "JSONExtractString(tr, 'email') != ''");
  assert.equal(conditionSql({ field: "email", op: "missing" }, 5, params), "JSONExtractString(tr, 'email') = ''");
  assert.deepEqual(params, { p0d: 7, p1d: 30, p2n: 3, p3n: 9 });
});

test("no value is ever written into the SQL text", () => {
  const evil = "x') OR 1=1 --";
  const params: Record<string, unknown> = {};
  const all: ProfileFilter[] = [
    { field: "trait", key: evil, op: "eq", value: evil },
    { field: "trait", key: evil, op: "contains", value: evil },
    { field: "email", op: "contains", value: evil },
  ];
  const sql = all.map((c, i) => conditionSql(c, i, params)).join(" ");
  assert.ok(!sql.includes("OR 1=1"));
  assert.ok(Object.values(params).includes(evil));
});

test("conditions combine with AND for 'all', OR for 'any', and nothing when empty", () => {
  const conds: ProfileFilter[] = [{ field: "sessions", op: "gte", value: 2 }, { field: "events", op: "gte", value: 5 }];
  assert.equal(buildProfileHaving(conds, "all").having, "(ss >= {p0n:UInt64} AND ev >= {p1n:UInt64})");
  assert.equal(buildProfileHaving(conds, "any").having, "(ss >= {p0n:UInt64} OR ev >= {p1n:UInt64})");
  assert.equal(buildProfileHaving([], "all").having, "");
});

test("a page asks for one extra row to learn whether there is more, and every query is tenant-scoped", async () => {
  const { client, calls } = fake([raw({ distinct_id: "a" }), raw({ distinct_id: "b" }), raw({ distinct_id: "c" })]);
  const page = await listProfiles({ workspaceId: W, siteId: S, limit: 2, offset: 0 }, client);
  assert.deepEqual(page.profiles.map((p) => p.distinctId), ["a", "b"]);
  assert.equal(page.hasMore, true);
  assert.equal(calls[0]!.params.limit, 3);
  assert.match(calls[0]!.query, /workspace_id = \{workspaceId:UUID\} AND site_id = \{siteId:UUID\}/);
  assert.ok(!calls[0]!.query.includes("HAVING")); // no search, no filter
});

test("search adds a case-insensitive match over id, name and email", async () => {
  const { client, calls } = fake([]);
  await listProfiles({ workspaceId: W, siteId: S, search: " ada ", limit: 50, offset: 0 }, client);
  assert.match(calls[0]!.query, /positionCaseInsensitiveUTF8\(distinct_id/);
  assert.equal(calls[0]!.params.q, "ada");
});

test("stats and single-profile reads", async () => {
  const stats = fake([{ total: "40", active7d: "9", avg_events: "12.4" }]);
  assert.deepEqual(await profileStats(W, S, stats.client), { total: 40, active7d: 9, avgEvents: 12 });
  const none = fake([]);
  assert.equal(await getProfile(W, S, "ghost", none.client), null);
  assert.equal(none.calls[0]!.params.id, "ghost");
  const one = fake([raw()]);
  assert.equal((await getProfile(W, S, "u1", one.client))!.name, "Ada");
});

test("a segment search applies its conditions as HAVING and caps the result", async () => {
  const { client, calls } = fake([raw()]);
  const found = await findProfiles(
    { workspaceId: W, siteId: S, conditions: [{ field: "events", op: "gte", value: 5 }], match: "all", limit: 1000 },
    client
  );
  assert.equal(found.length, 1);
  assert.match(calls[0]!.query, /HAVING \(ev >= \{p0n:UInt64\}\)/);
  assert.equal(calls[0]!.params.limit, 1000);
});
