import { test } from "node:test";
import assert from "node:assert/strict";
import { caseFile, ticketText } from "./case-file";
import type { Answer } from "./types";

// A fixture for the formatter only. The product never ships answers; every real one comes from a run over the person's data.
const q = "Which error costs us the most revenue?";
const answer: Answer = {
  steps: [],
  blocks: [{ type: "text", text: "One error cost the most [1]." }],
  evidence: [{ n: 1, title: "Failed orders by error", source: "errors", table: "t", language: "sql", query: "SELECT 1", range: "Last 30 days", rows: 1, ms: 5, columns: ["a"], sample: [[1]] }],
  assumptions: ["Failed orders count at full value."],
  confidence: "medium",
  followups: [],
  ideas: [],
  trail: {
    nodes: [{ kind: "error", title: "TypeError on the checkout page", detail: "Thrown on submit.", cite: 1 }],
    total: { value: "₹1,000", label: "of orders failed", basis: "Sum of failed order values." },
  },
};

test("a case file carries the question, the cost, every query and the assumptions", () => {
  const md = caseFile(q, answer, { site: "acme.com", range: "Last 30 days", at: new Date("2026-11-09T10:00:00Z") });
  assert.match(md, /^# Which error/);
  assert.match(md, /₹1,000/);
  assert.match(md, /```sql/);
  assert.match(md, /## Assumptions/);
  assert.equal((md.match(/### \[\d+\]/g) ?? []).length, answer.evidence.length);
});

test("a ticket leads with the cause and the money", () => {
  const t = ticketText(q, answer);
  assert.match(t.split("\n")[0]!, /TypeError on the checkout page: ₹1,000/);
  assert.match(t, /Start from/);
});
