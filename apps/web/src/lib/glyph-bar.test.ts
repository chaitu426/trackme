import { test } from "node:test";
import assert from "node:assert/strict";
import { glyphBar } from "./glyph-bar";

test("an empty bar has no filled cells; use of any size shows at least one", () => {
  assert.equal(glyphBar(0, 100, 20).filled, "");
  assert.equal(glyphBar(1, 100_000, 20).filled.length, 1);
});

test("the fill is proportional and fades out through + and :", () => {
  const bar = glyphBar(50, 100, 20);
  assert.equal(bar.filled.length, 10);
  assert.equal(bar.filled, "########+:");
  assert.equal(bar.state, "ok");
});

test("the bar is full only at the limit; just under it stays one cell short", () => {
  assert.equal(glyphBar(99_999, 100_000, 20).filled.length, 19);
  const full = glyphBar(100_000, 100_000, 20);
  assert.equal(full.filled, "#".repeat(20));
  assert.equal(full.state, "full");
  assert.equal(glyphBar(250_000, 100_000, 20).filled, "#".repeat(20));
});

test("the state turns to a warning at 80% and to full at the limit", () => {
  assert.equal(glyphBar(79, 100).state, "ok");
  assert.equal(glyphBar(80, 100).state, "warn");
  assert.equal(glyphBar(99, 100).state, "warn");
  assert.equal(glyphBar(100, 100).state, "full");
});

test("no limit is unlimited and draws nothing; a zero limit counts as full", () => {
  assert.deepEqual(glyphBar(1234, null), { filled: "", cells: 28, ratio: 0, state: "unlimited" });
  assert.equal(glyphBar(0, 0).state, "full");
});

test("the filled part never exceeds the bar", () => {
  for (const value of [0, 1, 7, 33, 50, 99, 100, 5000]) {
    assert.ok(glyphBar(value, 100, 28).filled.length <= 28);
  }
});
