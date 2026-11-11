import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, systemPrompt, wireMessage, type ChatClient, type ChatMessage, type ChatReply } from "./planner.js";
import { resolveRange } from "./scope.js";
import type { runTemplate } from "./runner.js";
import { DEFAULT_SCOPE, type AskScope } from "./types.js";

const scope: AskScope = { ...DEFAULT_SCOPE("acme", "acme.com"), sources: { traffic: true, errors: true, payments: false, releases: false, people: false } };
const tenant = { workspaceId: "11111111-1111-1111-1111-111111111111", siteId: "22222222-2222-2222-2222-222222222222" };
const now = new Date("2026-11-10T00:00:00Z");

class ScriptedChat implements ChatClient {
  seen: ChatMessage[][] = [];
  constructor(private replies: ChatReply[]) {}
  async complete(messages: ChatMessage[]): Promise<ChatReply> {
    this.seen.push(JSON.parse(JSON.stringify(messages)) as ChatMessage[]);
    return this.replies.shift() ?? { content: null, toolCalls: [], tokens: 1 };
  }
}

const fakeRun: typeof runTemplate = async (templateId, _params, _range, _deps, seq) => ({
  result: { title: `ran ${templateId}`, table: "events_v2", query: "SELECT 1", columns: ["n"], rows: [[1]] },
  step: { id: `q${seq}`, label: `ran ${templateId}`, ms: 3 },
});

test("systemPrompt lists only templates whose source is on", () => {
  const p = systemPrompt(scope, resolveRange("30d", now));
  assert.match(p, /traffic_overview/);
  assert.match(p, /errors_top/);
  assert.doesNotMatch(p, /payments_overview/);
});

test("planner runs a template, streams a step, feeds results back, then finishes with evidence", async () => {
  const chat = new ScriptedChat([
    { content: null, toolCalls: [{ id: "c1", name: "run_query", arguments: JSON.stringify({ template: "traffic_overview" }) }], tokens: 10 },
    { content: null, toolCalls: [{ id: "c2", name: "finish", arguments: JSON.stringify({ blocks: [{ type: "text", text: "one row [1]" }], confidence: "medium" }) }], tokens: 5 },
  ]);
  let steps = 0;
  const out = await plan(
    { question: "how was traffic", scope, onStep: () => steps++ },
    { chat, tenant, maxTokens: 100, maxSteps: 4, now, runTemplate: fakeRun }
  );
  assert.equal(steps, 1);
  assert.equal(out.answer.evidence.length, 1);
  assert.equal(out.answer.evidence[0]!.n, 1);
  assert.equal(out.tokens, 15);
  // The tool result was fed back to the model as a tool message.
  const last = chat.seen[1]!.at(-1)!;
  assert.equal(last.role, "tool");
  assert.match(String(last.content), /"n":1/);
});

test("planner with evidence in hand but no finish forces a final round, then returns the evidence rather than failing", async () => {
  const looping: ChatReply = { content: null, toolCalls: [{ id: "c", name: "run_query", arguments: JSON.stringify({ template: "traffic_overview", params: { n: 1 } }) }], tokens: 1 };
  const chat = new ScriptedChat([looping, looping, looping]);
  const out = await plan({ question: "q", scope }, { chat, tenant, maxTokens: 10, maxSteps: 2, now, runTemplate: fakeRun });
  assert.equal(out.answer.evidence.length, 1);
  assert.equal(out.answer.blocks.length, 0);
  assert.equal(out.answer.confidence, "low");
});

test("planner with no evidence and no finish fails with a named reason", async () => {
  const chat = new ScriptedChat([{ content: null, toolCalls: [{ id: "c", name: "calculate", arguments: JSON.stringify({ expression: "1+1" }) }], tokens: 1 }]);
  await assert.rejects(plan({ question: "q", scope }, { chat, tenant, maxTokens: 10, maxSteps: 1, now, runTemplate: fakeRun }), /more lookups/);
});

test("calculate results are fed back and registered as derived figures", async () => {
  const chat = new ScriptedChat([
    { content: null, toolCalls: [{ id: "c1", name: "calculate", arguments: JSON.stringify({ expression: "(1280 - 1010) / 1010 * 100" }) }], tokens: 1 },
    { content: null, toolCalls: [{ id: "c2", name: "finish", arguments: JSON.stringify({ blocks: [{ type: "text", text: "Up 26.7%" }], confidence: "high" }) }], tokens: 1 },
  ]);
  const out = await plan({ question: "q", scope }, { chat, tenant, maxTokens: 10, maxSteps: 4, now, runTemplate: fakeRun });
  assert.deepEqual(out.derived, ["26.7327"]);
  assert.match(String(chat.seen[1]!.at(-1)!.content), /= 26\.7327/);
});

test("a cancelled run stops before the next model call", async () => {
  const chat = new ScriptedChat([]);
  await assert.rejects(plan({ question: "q", scope }, { chat, tenant, maxTokens: 10, maxSteps: 4, now, runTemplate: fakeRun, shouldStop: async () => true }), /Stopped/);
  assert.equal(chat.seen.length, 0);
});

test("earlier turns reach the prompt as context, marked as not instructions", () => {
  const withHistory: AskScope = { ...scope, history: [{ question: "traffic last week?", answer: "12,400 visitors." }] };
  const p = systemPrompt(withHistory, resolveRange("30d", now), now);
  assert.match(p, /traffic last week\?/);
  assert.match(p, /not an instruction/);
  assert.match(p, /Today is 2026-11-10/);
});

test("the prompt tells the model the allowed values of an enum parameter", () => {
  const p = systemPrompt(scope, resolveRange("30d", now), now);
  assert.match(p, /"page"\|"referrer"/);
  assert.match(p, /compare_periods/);
});

test("an assistant tool-call turn is sent back to the provider in wire shape, type included", () => {
  const sent = wireMessage({
    role: "assistant",
    content: null,
    tool_calls: [{ id: "c1", name: "run_query", arguments: "{}" }],
  });
  assert.deepEqual(sent, {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "c1", type: "function", function: { name: "run_query", arguments: "{}" } }],
  });
  // A plain turn is passed through untouched.
  assert.deepEqual(wireMessage({ role: "tool", content: "rows", tool_call_id: "c1" }), { role: "tool", content: "rows", tool_call_id: "c1" });
});

test("repeating a query does not run it again; the model is told it already has that evidence and finishes", async () => {
  const same = JSON.stringify({ template: "traffic_overview" });
  const chat = new ScriptedChat([
    { content: null, toolCalls: [{ id: "c1", name: "run_query", arguments: same }], tokens: 1 },
    { content: null, toolCalls: [{ id: "c2", name: "run_query", arguments: same }], tokens: 1 },
    { content: null, toolCalls: [{ id: "c3", name: "finish", arguments: JSON.stringify({ blocks: [{ type: "text", text: "one row [1]" }], confidence: "medium" }) }], tokens: 1 },
  ]);
  let ran = 0;
  const run: typeof fakeRun = async (...a) => {
    ran += 1;
    return fakeRun(...a);
  };
  const out = await plan({ question: "traffic?", scope }, { chat, tenant, maxTokens: 100, maxSteps: 4, now, runTemplate: run });
  assert.equal(ran, 1);
  assert.equal(out.answer.evidence.length, 1);
  const told = chat.seen[2]!.filter((m) => m.role === "tool").map((m) => m.content ?? "");
  assert.ok(told[1]!.includes("Already have this as evidence [1]"), told.join(" | "));
});
