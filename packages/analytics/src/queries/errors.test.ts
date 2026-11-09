import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getErrorGroup,
  getErrorReleaseBreakdown,
  getErrorTrends,
  getOccurrences,
  getRecentReleasesForGroups,
  getTagBreakdown,
  listErrorGroups,
  parseCursor,
} from "./errors.js";

const SITE = "22222222-2222-2222-2222-222222222222";
const WS = "11111111-1111-1111-1111-111111111111";

function fake(rows: unknown[] = []) {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const client = {
    async query({ query, query_params }: { query: string; query_params: Record<string, unknown> }) {
      calls.push({ query, params: query_params });
      return { json: async () => rows };
    },
  };
  return { client: client as never, calls };
}

const base = { siteId: SITE, from: "2026-11-01", to: "2026-11-09", sort: "events" as const, limit: 2 };

test("a cursor is two digit runs or nothing", () => {
  assert.deepEqual(parseCursor("12:345"), { value: "12", groupId: "345" });
  for (const bad of [undefined, "", "12", "12:", "a:b", "1; DROP TABLE x:2", "12:34:56", "-1:2"]) {
    assert.equal(parseCursor(bad), null, String(bad));
  }
});

test("the list binds the site, asks for one extra row, and never puts values in the SQL text", async () => {
  const { client, calls } = fake();
  await listErrorGroups({ ...base, release: "x'; DROP TABLE y; --", cursor: "9:8", excludeGroupIds: ["5", "not-a-number"] }, client);
  const { query, params } = calls[0]!;
  assert.match(query, /site_id = \{siteId:UUID\}/);
  assert.equal(params.siteId, SITE);
  assert.equal(params.limit, 3);
  assert.ok(!query.includes("DROP TABLE"));
  assert.deepEqual(params.excludeIds, ["5"], "only digit ids are passed on");
  assert.equal(params.release, "x'; DROP TABLE y; --");
});

test("a garbage cursor is ignored rather than breaking or injecting", async () => {
  const { client, calls } = fake();
  await listErrorGroups({ ...base, cursor: "1; DROP TABLE x" }, client);
  assert.ok(!("cursorValue" in calls[0]!.params));
});

test("the next cursor is the last returned row's sort value and id, only when another page exists", async () => {
  const row = (id: string, sort: number) => ({
    group_id: id, events: sort, users: 1, last_ts: "", sort_value: sort, title: "T", etype: "E", level: "error",
    first_seen: "", last_seen: "", first_release: "", last_release: "",
  });
  const more = fake([row("30", 9), row("20", 5), row("10", 1)]);
  const page = await listErrorGroups(base, more.client);
  assert.equal(page.groups.length, 2);
  assert.equal(page.nextCursor, "5:20");
  const last = fake([row("30", 9)]);
  assert.equal((await listErrorGroups(base, last.client)).nextCursor, null);
});

test("an id that is not a number never reaches ClickHouse", async () => {
  const { client, calls } = fake();
  assert.equal(await getErrorGroup(SITE, "1 OR 1=1", client), null);
  assert.deepEqual(await getErrorTrends(SITE, ["x", "1;2"], "2026-11-01", "2026-11-09", client), []);
  assert.deepEqual(await getErrorReleaseBreakdown(SITE, "abc", "2026-11-01", "2026-11-09", client), []);
  assert.deepEqual(await getOccurrences(WS, SITE, "abc", 5, client), []);
  assert.deepEqual(await getTagBreakdown(WS, SITE, "abc", client), []);
  assert.deepEqual(await getRecentReleasesForGroups([{ siteId: "not-a-uuid", groupId: "1", since: "2026-11-01" }], client), []);
  assert.equal(calls.length, 0);
});

test("every per-issue query is scoped to the site, and occurrence reads also to the workspace", async () => {
  const { client, calls } = fake();
  await getErrorGroup(SITE, "7", client);
  await getErrorTrends(SITE, ["7"], "2026-11-01", "2026-11-09", client);
  await getErrorReleaseBreakdown(SITE, "7", "2026-11-01", "2026-11-09", client);
  await getOccurrences(WS, SITE, "7", 5, client);
  await getTagBreakdown(WS, SITE, "7", client);
  assert.equal(calls.length, 5);
  for (const c of calls) {
    assert.match(c.query, /site_id = \{siteId:UUID\}/);
    assert.equal(c.params.siteId, SITE);
  }
  for (const c of calls.slice(3)) {
    assert.match(c.query, /workspace_id = \{workspaceId:UUID\}/);
    assert.equal(c.params.workspaceId, WS);
  }
});
