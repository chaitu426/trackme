import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserSummary, getUserTimelinePage, parseTimelineCursor } from "./user360.js";

const SITE = "22222222-2222-2222-2222-222222222222";
const ID = "3f2b8c1e-5a47-4d9e-8b21-0c6f7a1d9e42";

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

const row = (n: number) => ({ eid: `00000000-0000-4000-8000-00000000000${n}`, ms: 1_760_000_000_000 + n, kind: "page", summary: `/p${n}`, sev: "info", ref: "", sess: "1", rel: "" });

test("a cursor is milliseconds plus a UUID, or nothing", () => {
  assert.deepEqual(parseTimelineCursor(`1760000000000:${ID}`), { ms: "1760000000000", eventId: ID });
  for (const bad of [undefined, "", "abc", `12:${ID}`, `1760000000000:not-a-uuid`, `1760000000000:${ID}; DROP`]) {
    assert.equal(parseTimelineCursor(bad), null, String(bad));
  }
});

test("the user and site are bound parameters; filters are limited to short lowercase words", async () => {
  const { client, calls } = fake();
  await getUserTimelinePage({ siteId: SITE, userId: "x'; DROP TABLE y; --", kinds: ["page", "x'; DROP"], severities: ["error", "BAD"], limit: 10 }, client);
  const { query, params } = calls[0]!;
  assert.match(query, /site_id = \{siteId:UUID\}/);
  assert.equal(params.userId, "x'; DROP TABLE y; --");
  assert.ok(!query.includes("DROP"));
  assert.deepEqual(params.kinds, ["page"]);
  assert.deepEqual(params.severities, ["error"]);
  assert.equal(params.limit, 11);
});

test("a bad cursor is ignored, a good one becomes a keyset condition", async () => {
  const bad = fake();
  await getUserTimelinePage({ siteId: SITE, userId: "u", cursor: "garbage", limit: 5 }, bad.client);
  assert.ok(!("cursorMs" in bad.calls[0]!.params));
  const good = fake();
  await getUserTimelinePage({ siteId: SITE, userId: "u", cursor: `1760000000000:${ID}`, limit: 5 }, good.client);
  assert.match(good.calls[0]!.query, /\(ts, event_id\) </);
  assert.equal(good.calls[0]!.params.cursorMs, "1760000000000");
});

test("the next cursor points at the last row returned, and only exists when there is more", async () => {
  const more = fake([row(3), row(2), row(1)]);
  const page = await getUserTimelinePage({ siteId: SITE, userId: "u", limit: 2 }, more.client);
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, `${row(2).ms}:${row(2).eid}`);
  assert.equal(page.items[0]!.at, new Date(row(3).ms).toISOString());
  const last = fake([row(1)]);
  assert.equal((await getUserTimelinePage({ siteId: SITE, userId: "u", limit: 2 }, last.client)).nextCursor, null);
});

test("an unknown severity from storage reads as info", async () => {
  const { client } = fake([{ ...row(1), sev: "weird" }]);
  assert.equal((await getUserTimelinePage({ siteId: SITE, userId: "u", limit: 5 }, client)).items[0]!.severity, "info");
});

test("the summary of a person with no activity is empty, not an error", async () => {
  const { client } = fake([]);
  const s = await getUserSummary(SITE, "nobody", client);
  assert.deepEqual([s.firstSeen, s.lastSeen, s.sessions, s.lastError], [null, null, 0, null]);
});
