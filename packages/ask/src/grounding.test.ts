import { test } from "node:test";
import assert from "node:assert/strict";
import { groundAnswer, citationsOf, numbersIn, fallbackAnswer } from "./grounding.js";
import type { Answer, EvidenceItem } from "./types.js";

const ev = (n: number, sample: Array<Array<string | number>>): EvidenceItem => ({
  n,
  title: `e${n}`,
  source: "payments",
  table: "t",
  language: "sql",
  query: "SELECT 1",
  range: "Last 30 days",
  rows: sample.length,
  ms: 5,
  columns: ["a"],
  sample,
});

const base = (over: Partial<Answer>): Answer => ({
  steps: [],
  blocks: [],
  evidence: [ev(1, [[442, "61.8%"]]), ev(2, [[113, "23%"]])],
  assumptions: [],
  confidence: "high",
  followups: [],
  ideas: [],
  ...over,
});

test("numbersIn normalizes money and percentages", () => {
  assert.deepEqual(numbersIn("₹195,970 and 61.8%"), ["195970", "61.8"]);
});

test("a text block whose figures are all in cited evidence is kept", () => {
  const a = base({ blocks: [{ type: "text", text: "442 sessions, 61.8% converted [1]." }] });
  const r = groundAnswer(a);
  assert.equal(r.answer.blocks.length, 1);
  assert.equal(r.grounded, true);
});

test("a text block with a figure not in its evidence is dropped", () => {
  const a = base({ blocks: [{ type: "text", text: "We lost ₹999,999 [1]." }] });
  const r = groundAnswer(a);
  assert.equal(r.answer.blocks.length, 0);
  assert.equal(r.dropped.length, 1);
});

test("a block citing missing evidence is dropped", () => {
  const a = base({ blocks: [{ type: "stats", items: [{ label: "x", value: "1", cite: 9 }] }] });
  const r = groundAnswer(a);
  assert.equal(r.answer.blocks.length, 0);
});

test("a stat with no citation is kept (a figure the evidence list covers wholesale)", () => {
  const a = base({ blocks: [{ type: "stats", items: [{ label: "x", value: "1", cite: 1 }, { label: "y", value: "2", cite: 9 }] }] });
  const r = groundAnswer(a);
  const block = r.answer.blocks[0];
  assert.ok(block && block.type === "stats");
  assert.equal(block.items.length, 1);
});

test("citationsOf covers blocks and trail", () => {
  const a = base({
    blocks: [{ type: "text", text: "a [1] b [2]" }],
    trail: { nodes: [{ kind: "money", title: "c", detail: "d", cite: 2 }], total: { value: "1", label: "l", basis: "b" } },
  });
  assert.deepEqual(citationsOf(a), [1, 2, 2]);
});

test("a trail with an ungrounded node is trimmed; below two nodes it is removed", () => {
  const a = base({
    blocks: [{ type: "text", text: "442 [1]" }],
    trail: {
      nodes: [
        { kind: "error", title: "ok", detail: "", cite: 1 },
        { kind: "money", title: "bad", detail: "", cite: 9 },
      ],
      total: { value: "1", label: "l", basis: "b" },
    },
  });
  const r = groundAnswer(a);
  assert.equal(r.answer.trail, undefined);
});

test("a figure rounded the way a person writes it is still grounded", () => {
  const answer = base({ evidence: [ev(1, [[61.84, "0.618"]])], blocks: [{ type: "text", text: "About 61.8% [1], or 62% of sessions [1]." }] });
  // 61.84 → "61.8" matches; "62" does not match at 0 decimals only if rounding fails: round(61.84, 0) === 62.
  assert.equal(groundAnswer(answer).answer.blocks.length, 1);
});

test("a calculator result and the question's own frame are grounded; an invented figure is still dropped", () => {
  const answer = base({
    evidence: [ev(1, [[1280, 1010]])],
    blocks: [{ type: "text", text: "Up 26.7% over the last 30 days [1]." }],
  });
  assert.equal(groundAnswer(answer).answer.blocks.length, 0);
  assert.equal(groundAnswer(answer, { derived: ["26.7327"], allowed: ["30"] }).answer.blocks.length, 1);
  const invented = base({ evidence: [ev(1, [[1280, 1010]])], blocks: [{ type: "text", text: "Up 99% [1]." }] });
  assert.equal(groundAnswer(invented, { derived: ["26.7327"], allowed: ["30"] }).answer.blocks.length, 0);
});

test("dates and ranges in prose are not read as negative figures", () => {
  assert.deepEqual(numbersIn("from 2026-11-10 to 3-5 pages"), ["2026", "11", "10", "3", "5"]);
  assert.deepEqual(numbersIn("down -4.5%"), ["-4.5"]);
});

test("when the gate drops every block the person still gets the evidence, never an empty answer", () => {
  const dropped = groundAnswer(base({ blocks: [{ type: "text", text: "Revenue was 999 [1]." }] }));
  assert.equal(dropped.grounded, false);
  const out = fallbackAnswer(dropped.answer, dropped.dropped);
  assert.equal(out.confidence, "low");
  assert.equal(out.blocks[0]?.type, "callout");
  assert.equal(out.blocks.filter((b) => b.type === "table").length, 2);
  const none = fallbackAnswer({ ...dropped.answer, evidence: [] }, []);
  assert.equal(none.blocks[0]?.type, "text");
});
