import { test } from "node:test";
import assert from "node:assert/strict";
import { processRun, type RunDeps, type RunRecord } from "./run.js";
import type { Answer } from "@trackme/ask";
import { DEFAULT_SCOPE } from "@trackme/ask";

const record: RunRecord = {
  id: "run-1",
  workspaceId: "ws-1",
  siteId: "site-1",
  question: "how was traffic",
  scope: DEFAULT_SCOPE("acme", "acme.com"),
};

const okAnswer: Answer = {
  steps: [{ id: "q1", label: "ran", ms: 3 }],
  blocks: [{ type: "callout", tone: "info", text: "fine" }],
  evidence: [],
  assumptions: [],
  confidence: "high",
  followups: [],
  ideas: [],
};

function deps(over: Partial<RunDeps> = {}): { d: RunDeps; calls: string[] } {
  const calls: string[] = [];
  const d: RunDeps = {
    store: {
      load: async () => record,
      markRunning: async () => void calls.push("running"),
      heartbeat: async () => undefined,
      markDone: async (_id, a) => void calls.push(`done:${a.blocks.length}`),
      markFailed: async (_id, e) => void calls.push(`failed:${e}`),
    },
    publish: async (e) => void calls.push(`pub:${e.type}`),
    plan: async (_r, onStep) => {
      onStep(okAnswer.steps[0]!);
      return { answer: okAnswer, tokens: 12 };
    },
    acquireSlot: async () => async () => void calls.push("release"),
    model: "test-model",
    ...over,
  };
  return { d, calls };
}

test("a good run: running, step published, grounded, done, released", async () => {
  const { d, calls } = deps();
  assert.equal(await processRun("run-1", d), "done");
  assert.deepEqual(calls, ["running", "pub:step", "done:1", "pub:answer", "release"]);
});

test("a missing run is skipped and no slot is taken", async () => {
  const { d, calls } = deps({ store: { ...deps().d.store, load: async () => null } });
  assert.equal(await processRun("nope", d), "skipped");
  assert.deepEqual(calls, []);
});

test("a full workspace skips without running the planner", async () => {
  const { d, calls } = deps({ acquireSlot: async () => null });
  assert.equal(await processRun("run-1", d), "skipped");
  assert.deepEqual(calls, []);
});

test("a planner failure marks the run failed, publishes an error, and releases the slot", async () => {
  const { d, calls } = deps({ plan: async () => Promise.reject(new Error("boom")) });
  assert.equal(await processRun("run-1", d), "failed");
  assert.ok(calls.some((c) => c.startsWith("failed:Ask could not finish")));
  assert.ok(calls.includes("pub:error"));
  assert.equal(calls.at(-1), "release");
});

test("grounding removes an ungrounded figure before the answer is persisted", async () => {
  const bad: Answer = { ...okAnswer, blocks: [{ type: "text", text: "we lost ₹9,999,999 [1]" }], evidence: [] };
  const { d } = deps({ plan: async () => ({ answer: bad, tokens: 1 }) });
  let persistedLen = -1;
  d.store.markDone = async (_id, a) => void (persistedLen = a.blocks.length);
  await processRun("run-1", d);
  assert.equal(persistedLen, 0);
});
