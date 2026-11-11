import { test } from "node:test";
import assert from "node:assert/strict";
import { processRun, type RunDeps, type RunRecord } from "./run.js";
import type { Answer } from "@trackme/ask";
import { DEFAULT_SCOPE, AskFailure } from "@trackme/ask";

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
      isCancelled: async () => false,
      markCancelled: async () => void calls.push("cancelled"),
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

test("a full workspace reports busy (so the consumer re-enqueues it) without running the planner", async () => {
  const { d, calls } = deps({ acquireSlot: async () => null });
  assert.equal(await processRun("run-1", d), "busy");
  assert.deepEqual(calls, []);
});

test("a run that is already finished is not run again when redelivered", async () => {
  const { d, calls } = deps({ store: { ...deps().d.store, load: async () => ({ ...record, status: "done" }) } });
  assert.equal(await processRun("run-1", d), "skipped");
  assert.deepEqual(calls, []);
});

test("a stopped run is marked cancelled, not failed, and the slot is released", async () => {
  const { d, calls } = deps({
    plan: async (_r, _s, control) => {
      d.store.isCancelled = async () => true;
      await control.shouldStop().then(async (stop) => {
        if (stop) throw new AskFailure("cancelled", "Stopped.");
      });
      return { answer: okAnswer, tokens: 1 };
    },
  });
  assert.equal(await processRun("run-1", d), "cancelled");
  assert.ok(calls.includes("cancelled"));
  assert.ok(!calls.some((c) => c.startsWith("failed")));
  assert.equal(calls.at(-1), "release");
});

test("a run past its deadline fails with the timeout message", async () => {
  const { d, calls } = deps({
    deadlineMs: -1,
    plan: async (_r, _s, control) => {
      await control.shouldStop();
      return { answer: okAnswer, tokens: 1 };
    },
  });
  assert.equal(await processRun("run-1", d), "failed");
  assert.ok(calls.some((c) => c.includes("took longer")));
});

test("a provider rate limit tells the person it is the provider, not a generic failure", async () => {
  const { d, calls } = deps({ plan: async () => Promise.reject(Object.assign(new Error("429"), { status: 429 })) });
  assert.equal(await processRun("run-1", d), "failed");
  assert.ok(calls.some((c) => c.includes("provider is busy")));
});

test("a planner failure marks the run failed, publishes an error, and releases the slot", async () => {
  const { d, calls } = deps({ plan: async () => Promise.reject(new Error("boom")) });
  assert.equal(await processRun("run-1", d), "failed");
  assert.ok(calls.some((c) => c.startsWith("failed:Ask could not finish")));
  assert.ok(calls.includes("pub:error"));
  assert.equal(calls.at(-1), "release");
});

test("grounding removes an ungrounded figure and the person gets the evidence instead of an empty answer", async () => {
  const bad: Answer = { ...okAnswer, blocks: [{ type: "text", text: "we lost ₹9,999,999 [1]" }], evidence: [] };
  const { d } = deps({ plan: async () => ({ answer: bad, tokens: 1 }) });
  let persisted: Answer | undefined;
  d.store.markDone = async (_id, a) => void (persisted = a);
  await processRun("run-1", d);
  assert.ok(persisted && persisted.blocks.length > 0, "never done with nothing on screen");
  assert.ok(!JSON.stringify(persisted).includes("9,999,999"));
  assert.equal(persisted?.confidence, "low");
});

test("a calculated figure passes the gate", async () => {
  const ans: Answer = {
    ...okAnswer,
    evidence: [{ n: 1, title: "t", source: "traffic", table: "t", language: "sql", query: "q", range: "r", rows: 1, ms: 1, columns: ["a", "b"], sample: [[1280, 1010]] }],
    blocks: [{ type: "text", text: "Up 26.7% [1]" }],
  };
  const { d } = deps({ plan: async () => ({ answer: ans, tokens: 1, derived: ["26.7327"] }) });
  let persisted: Answer | undefined;
  d.store.markDone = async (_id, a) => void (persisted = a);
  await processRun("run-1", d);
  assert.equal(persisted?.blocks[0]?.type, "text");
});
