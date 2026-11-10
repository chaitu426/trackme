import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueue, publish, replay, ensureGroup, streamKey, RUNS_STREAM, type QueueRedis, type RunEvent } from "./queue.js";

class FakeStreams implements QueueRedis {
  xadds: Array<{ key: string; args: Array<string | number> }> = [];
  entries = new Map<string, Array<[string, string[]]>>();
  groupCreated = false;
  async xadd(key: string, ...args: Array<string | number>) {
    this.xadds.push({ key, args });
    // emulate an entry: fields after "*" are [type, t, data, json]
    const i = args.indexOf("*");
    const fields = args.slice(i + 1).map(String);
    const list = this.entries.get(key) ?? [];
    list.push([`${list.length}-0`, fields]);
    this.entries.set(key, list);
    return `${list.length - 1}-0`;
  }
  async xgroup() {
    if (this.groupCreated) throw new Error("BUSYGROUP Consumer Group name already exists");
    this.groupCreated = true;
    return "OK";
  }
  async xreadgroup() {
    return null;
  }
  async xack() {
    return 1;
  }
  async xautoclaim() {
    return [];
  }
  async xrange(key: string) {
    return this.entries.get(key) ?? [];
  }
}

test("enqueue appends the run id to the runs stream with MAXLEN", async () => {
  const r = new FakeStreams();
  await enqueue(r, "run-1");
  assert.equal(r.xadds[0]!.key, RUNS_STREAM);
  assert.ok(r.xadds[0]!.args.includes("MAXLEN"));
  assert.ok(r.xadds[0]!.args.includes("run-1"));
});

test("ensureGroup tolerates an already-existing group", async () => {
  const r = new FakeStreams();
  await ensureGroup(r);
  await ensureGroup(r); // BUSYGROUP is swallowed
  assert.equal(r.groupCreated, true);
});

test("publish then replay round-trips events", async () => {
  const r = new FakeStreams();
  const events: RunEvent[] = [
    { type: "step", step: { id: "q1", label: "ran", ms: 2 } },
    { type: "answer", answer: { steps: [], blocks: [], evidence: [], assumptions: [], confidence: "low", followups: [], ideas: [] } },
    { type: "error", message: "boom" },
  ];
  for (const e of events) await publish(r, "run-1", e);
  assert.deepEqual(await replay(r, "run-1"), events);
  assert.equal(streamKey("run-1"), "ask:stream:run-1");
});
