import { test } from "node:test";
import assert from "node:assert/strict";
import { findRegression, groupFilter, transition } from "./error-status.js";

const T0 = new Date("2026-11-09T10:00:00Z");
const later = new Date("2026-11-09T11:00:00Z");
const earlier = new Date("2026-11-09T09:00:00Z");

test("each action leads to one clear state", () => {
  assert.equal(transition("resolve", T0, ["a"]).status, "resolved");
  assert.equal(transition("resolve", T0, ["a"]).knownReleases.length, 0);
  const next = transition("resolve_next_release", T0, ["web@1", "web@1", "", "web@2"]);
  assert.equal(next.mode, "next_release");
  assert.deepEqual(next.knownReleases, ["web@1", "web@2"]);
  assert.equal(transition("ignore", T0, []).status, "ignored");
  const reopened = transition("reopen", T0, []);
  assert.deepEqual([reopened.status, reopened.resolvedAt, reopened.regressedAt], ["open", null, null]);
});

test("the status filter keeps the right issues", () => {
  const rows = [
    { groupId: "1", status: "resolved" as const },
    { groupId: "2", status: "ignored" as const },
    { groupId: "3", status: "open" as const },
  ];
  assert.deepEqual(groupFilter(rows, "open"), { excludeGroupIds: ["1", "2"] });
  assert.deepEqual(groupFilter(rows, "resolved"), { onlyGroupIds: ["1"] });
  assert.deepEqual(groupFilter(rows, "ignored"), { onlyGroupIds: ["2"] });
  assert.deepEqual(groupFilter(rows, "all"), {});
  assert.deepEqual(groupFilter([], "resolved"), { onlyGroupIds: [] }, "no resolved issues means none match, not all");
});

test("an issue resolved now comes back on any occurrence after the resolve", () => {
  const state = { ...transition("resolve", T0, []) };
  assert.deepEqual(findRegression(state, [{ release: "web@1", lastSeen: later }]), { release: "web@1" });
  assert.deepEqual(findRegression(state, [{ release: "", lastSeen: later }]), { release: "" });
  assert.equal(findRegression(state, [{ release: "web@1", lastSeen: earlier }]), null);
  assert.equal(findRegression(state, []), null);
});

test("resolved in next release ignores builds that already had it, and reopens for a new one", () => {
  const state = transition("resolve_next_release", T0, ["web@1"]);
  assert.equal(findRegression(state, [{ release: "web@1", lastSeen: later }]), null);
  assert.equal(findRegression(state, [{ release: "", lastSeen: later }]), null);
  assert.deepEqual(
    findRegression(state, [{ release: "web@1", lastSeen: later }, { release: "web@2", lastSeen: later }]),
    { release: "web@2" }
  );
});

test("only resolved issues can regress", () => {
  for (const action of ["ignore", "reopen"] as const) {
    assert.equal(findRegression(transition(action, T0, []), [{ release: "x", lastSeen: later }]), null);
  }
});
