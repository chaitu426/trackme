import { test } from "node:test";
import assert from "node:assert/strict";
import { publishNewErrorGroups, type NewGroupDeps } from "./new-error-groups.js";
import { ALERT_STREAM, publishAlertEvent } from "./alert-events.js";

const group = (id: string) => ({ siteId: "s1", groupId: id, title: `Error ${id}`, release: "web@1.2.0", level: "error", firstSeenMs: 1 });

test("each new issue is published once, even when several runs see it", async () => {
  const claimed = new Set<string>();
  const out: string[] = [];
  const deps: NewGroupDeps = {
    fetchRecent: async () => [group("1"), group("2")],
    claim: async (s, g) => (claimed.has(`${s}:${g}`) ? false : (claimed.add(`${s}:${g}`), true)),
    publish: async (e) => void out.push(`${e.type}:${e.groupId}`),
    now: new Date("2026-11-09T00:00:00Z"),
  };
  assert.equal(await publishNewErrorGroups(deps), 2);
  assert.equal(await publishNewErrorGroups(deps), 0);
  assert.deepEqual(out, ["new_error_group:1", "new_error_group:2"]);
});

test("the stream entry carries identifiers and titles only, and skips empty fields", async () => {
  const calls: Array<Array<string | number>> = [];
  await publishAlertEvent({ xadd: async (key, ...rest) => void calls.push([key, ...rest]) }, { type: "error_regression", siteId: "s1", groupId: "9", release: "web@1.3.0", at: "2026-11-09T00:00:00.000Z" });
  assert.deepEqual(calls[0]!.slice(0, 5), [ALERT_STREAM, "MAXLEN", "~", 10000, "*"]);
  assert.deepEqual(calls[0]!.slice(5), ["type", "error_regression", "siteId", "s1", "groupId", "9", "release", "web@1.3.0", "at", "2026-11-09T00:00:00.000Z"]);
});
