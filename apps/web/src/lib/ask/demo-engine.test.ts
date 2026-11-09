import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFor, citationsOf, matchScript } from "./demo-engine";
import { DEFAULT_SCOPE } from "./types";

const scope = { ...DEFAULT_SCOPE("acme", "a.com"), sources: { traffic: true, errors: true, payments: true, releases: true, people: false } };
const base = "/acme/sites/a.com";

test("questions find their answer", () => {
  assert.equal(matchScript("Why did the payment success rate drop yesterday?")?.id, "success-drop");
  assert.equal(matchScript("Which error costs us the most at checkout?")?.id, "leak");
  assert.equal(matchScript("Where do visitors drop off in the checkout funnel?")?.id, "funnel");
  assert.equal(matchScript("How is the 1.2.0 release doing, should we rollback?")?.id, "release");
  assert.equal(matchScript("How was our traffic and bounce rate over 30 days?")?.id, "traffic");
});

test("a question with no real match is not forced onto an answer", () => {
  assert.equal(matchScript("What is the weather in Pune?"), null);
  assert.equal(matchScript("hello"), null);
});

test("an unmatched question is declined honestly, with no figures and a way forward", () => {
  const a = answerFor("What is the weather in Pune?", scope, base);
  assert.equal(a.evidence.length, 0);
  assert.equal(a.confidence, "low");
  assert.ok(a.limit && a.limit.includes("Configure"));
  assert.ok(a.followups.length > 0);
  assert.ok(!JSON.stringify(a.blocks).match(/\d{2,}/));
});

test("every citation in every prepared answer points at an evidence item that exists", () => {
  for (const q of ["payment success rate drop yesterday", "error costs checkout revenue", "drop off checkout funnel browser", "release 1.2.0 regress rollback", "traffic visitors sessions bounce 30 days"]) {
    const a = answerFor(q, scope, base);
    const have = new Set(a.evidence.map((e) => e.n));
    assert.ok(a.evidence.length > 0, q);
    for (const c of citationsOf(a)) assert.ok(have.has(c), `${q}: citation ${c} has no evidence`);
  }
});

test("every evidence item states its table, query, range, rows and timing, and numbers are sequential", () => {
  const a = answerFor("payment success rate drop yesterday", scope, base);
  a.evidence.forEach((e, i) => {
    assert.equal(e.n, i + 1);
    assert.ok(e.table && e.query && e.range && e.columns.length > 0 && e.sample.length > 0);
    assert.ok(e.rows >= 0 && e.ms > 0);
    assert.ok(!e.openHref || e.openHref.startsWith("/"));
  });
});

test("an answer whose source is switched off says which one to switch on instead of answering", () => {
  const off = { ...scope, sources: { ...scope.sources, payments: false } };
  const a = answerFor("payment success rate drop yesterday", off, base);
  assert.equal(a.evidence.length, 0);
  assert.ok(a.limit?.includes("payments"));
});

test("answers are honest about what they take for granted", () => {
  for (const q of ["error costs checkout revenue", "drop off checkout funnel browser"]) assert.ok(answerFor(q, scope, base).assumptions.length > 0);
});
