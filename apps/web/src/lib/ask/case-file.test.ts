import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFor, citationsOf } from "./demo-engine";
import { caseFile, ticketText } from "./case-file";
import { DEFAULT_SCOPE } from "./types";

const scope = DEFAULT_SCOPE("acme", "acme.com");

test("answers with a money trail cite evidence that exists", () => {
  for (const q of ["Why did the payment success rate drop yesterday?", "Which error costs us the most revenue at checkout?"]) {
    const a = answerFor(q, scope, "/acme/sites/acme.com");
    assert.ok(a.trail && a.trail.nodes.length >= 3, q);
    assert.ok(a.watch, q);
    const have = new Set(a.evidence.map((e) => e.n));
    for (const n of citationsOf(a)) assert.ok(have.has(n), `${q}: citation ${n}`);
  }
});

test("a case file carries the question, the cost, every query and the assumptions", () => {
  const q = "Which error costs us the most revenue at checkout?";
  const a = answerFor(q, scope, "/acme/sites/acme.com");
  const md = caseFile(q, a, { site: "acme.com", range: "Last 30 days", at: new Date("2026-11-09T10:00:00Z") });
  assert.match(md, /^# Which error/);
  assert.match(md, /₹195,970/);
  assert.match(md, /```sql/);
  assert.match(md, /## Assumptions/);
  assert.equal((md.match(/### \[\d+\]/g) ?? []).length, a.evidence.length);
});

test("a ticket leads with the cause and the money", () => {
  const q = "Which error costs us the most revenue at checkout?";
  const t = ticketText(q, answerFor(q, scope, "/x"));
  assert.match(t.split("\n")[0]!, /TypeError on the checkout page: ₹195,970/);
  assert.match(t, /Start from/);
});
