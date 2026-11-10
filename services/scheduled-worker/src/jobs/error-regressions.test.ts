import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRegressions, type ResolvedIssue } from "./error-regressions.js";

const SITE = "22222222-2222-2222-2222-222222222222";
const RESOLVED_AT = new Date("2026-11-09T10:00:00Z");

const issue = (id: string, mode: "now" | "next_release" = "now", knownReleases: string[] = []): ResolvedIssue => ({
  id,
  siteId: SITE,
  groupId: id,
  state: { status: "resolved", mode, resolvedAt: RESOLVED_AT, knownReleases },
});

function setup(issues: ResolvedIssue[], seen: Array<{ groupId: string; release: string; lastSeen: string }>) {
  const reopened: Array<{ id: string; release: string }> = [];
  const deps = {
    loadResolved: async () => issues,
    fetchSeen: async () => seen.map((s) => ({ siteId: SITE, ...s })),
    reopen: async (i: ResolvedIssue, release: string) => {
      reopened.push({ id: i.id, release });
      return true;
    },
    now: new Date("2026-11-09T12:00:00Z"),
  };
  return { deps, reopened };
}

test("a resolved issue that appears again is reopened with the release that brought it back", async () => {
  const { deps, reopened } = setup([issue("1")], [{ groupId: "1", release: "web@2", lastSeen: "2026-11-09T11:00:00Z" }]);
  assert.equal(await detectRegressions(deps), 1);
  assert.deepEqual(reopened, [{ id: "1", release: "web@2" }]);
});

test("nothing new since the resolve means nothing is reopened", async () => {
  const { deps, reopened } = setup([issue("1")], [{ groupId: "1", release: "web@1", lastSeen: "2026-11-09T09:00:00Z" }]);
  assert.equal(await detectRegressions(deps), 0);
  assert.equal(reopened.length, 0);
});

test("resolved in next release: the old build raising it again is not a regression, a newer one is", async () => {
  const { deps, reopened } = setup(
    [issue("1", "next_release", ["web@1"]), issue("2", "next_release", ["web@1"])],
    [
      { groupId: "1", release: "web@1", lastSeen: "2026-11-09T11:00:00Z" },
      { groupId: "2", release: "web@2", lastSeen: "2026-11-09T11:00:00Z" },
    ]
  );
  assert.equal(await detectRegressions(deps), 1);
  assert.deepEqual(reopened, [{ id: "2", release: "web@2" }]);
});

test("an issue changed by a person in the meantime is not counted", async () => {
  const { deps } = setup([issue("1")], [{ groupId: "1", release: "web@2", lastSeen: "2026-11-09T11:00:00Z" }]);
  assert.equal(await detectRegressions({ ...deps, reopen: async () => false }), 0);
});

test("a long list is checked in batches of 500", async () => {
  const issues = Array.from({ length: 1100 }, (_, i) => issue(String(i + 1)));
  let calls = 0;
  const { deps } = setup(issues, []);
  await detectRegressions({ ...deps, fetchSeen: async () => (calls++, []) });
  assert.equal(calls, 3);
});

test("with nothing resolved, ClickHouse is never queried", async () => {
  let calls = 0;
  const { deps } = setup([], []);
  await detectRegressions({ ...deps, fetchSeen: async () => (calls++, []) });
  assert.equal(calls, 0);
});
