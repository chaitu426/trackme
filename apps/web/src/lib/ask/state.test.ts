import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, MAX_HISTORY, MAX_QUESTION, reduce } from "./state";
import { askContext, areaOf } from "./context";
import { DEFAULT_SCOPE, type Answer } from "./types";

const scope = DEFAULT_SCOPE("acme", "a.com");
const answer: Answer = { steps: [{ id: "1", label: "a", ms: 1 }, { id: "2", label: "b", ms: 1 }], blocks: [], evidence: [], assumptions: [], confidence: "high", followups: [], ideas: [] };
const ask = (s = initialState(scope), id = "t1", q = "why?") => reduce(s, { type: "ask", id, question: q, page: "Overview", at: "2026-11-09T00:00:00Z" });

test("asking opens the panel, clears the draft and adds a thinking turn", () => {
  const s = ask({ ...initialState(scope), draft: "why?" });
  assert.equal(s.open, true);
  assert.equal(s.draft, "");
  assert.deepEqual(s.turns.map((t) => [t.question, t.status, t.shownSteps]), [["why?", "thinking", 0]]);
});

test("an empty or whitespace question does nothing", () => {
  const s = initialState(scope);
  assert.equal(reduce(s, { type: "ask", id: "x", question: "   ", page: "", at: "" }), s);
});

test("steps are revealed one at a time and the answer completes the turn", () => {
  let s = ask();
  s = reduce(s, { type: "step", id: "t1" });
  assert.equal(s.turns[0]!.shownSteps, 1);
  s = reduce(s, { type: "answer", id: "t1", answer });
  assert.equal(s.turns[0]!.status, "done");
  assert.equal(s.turns[0]!.shownSteps, 2);
  // A late step after the answer changes nothing.
  assert.equal(reduce(s, { type: "step", id: "t1" }).turns[0]!.shownSteps, 2);
});

test("an answer that arrives while the panel is folded leaves a mark on the pill, cleared on open", () => {
  let s = ask();
  s = reduce(s, { type: "fold" });
  s = reduce(s, { type: "answer", id: "t1", answer });
  assert.equal(s.unseen, true);
  assert.equal(reduce(s, { type: "open" }).unseen, false);
});

test("an answer while open leaves no mark", () => {
  assert.equal(reduce(ask(), { type: "answer", id: "t1", answer }).unseen, false);
});

test("the same question moves to the top of the history instead of repeating", () => {
  let s = ask(initialState(scope), "a", "first");
  s = ask(s, "b", "second");
  s = ask(s, "c", "first");
  assert.deepEqual(s.history.map((h) => h.question), ["first", "second"]);
});

test("history and question length are bounded", () => {
  let s = initialState(scope);
  for (let i = 0; i < MAX_HISTORY + 10; i += 1) s = ask(s, `t${i}`, `question ${i}`);
  assert.equal(s.history.length, MAX_HISTORY);
  assert.equal(reduce(s, { type: "draft", text: "x".repeat(MAX_QUESTION + 50) }).draft.length, MAX_QUESTION);
});

test("clear empties the conversation but keeps history and scope", () => {
  const s = reduce(ask(), { type: "clear" });
  assert.equal(s.turns.length, 0);
  assert.equal(s.history.length, 1);
  assert.equal(s.scope, scope);
});

test("switching view opens the panel", () => {
  assert.equal(reduce(initialState(scope), { type: "view", view: "configure" }).open, true);
});

test("suggestions follow the part of the app", () => {
  assert.equal(areaOf("/acme/sites/a.com/payments/leaks", "acme"), "payments");
  assert.equal(areaOf("/acme/sites/a.com/errors/123", "acme"), "errors");
  assert.equal(areaOf("/acme/overview", "acme"), "traffic");
  assert.equal(areaOf("/acme/settings", "acme"), "settings");
  assert.equal(areaOf("/other/overview", "acme"), "general");
  const c = askContext("/acme/sites/a.com/payments/health", "acme");
  assert.equal(c.page, "Gateway Health");
  assert.equal(c.suggestions.length, 3);
});
