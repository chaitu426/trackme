import { test } from "node:test";
import assert from "node:assert/strict";
import { glyphLevel } from "./matrix-loader";

test("the wave is brightest at its head and dark ahead of it", () => {
  // At frame 3 the head (level 3) sits on the cell whose diagonal is 0; later diagonals trail behind it.
  assert.equal(glyphLevel(0, 0, 3, 7), 3);
  assert.equal(glyphLevel(0, 1, 3, 7), 2);
  assert.equal(glyphLevel(1, 1, 3, 7), 1);
  assert.equal(glyphLevel(2, 1, 3, 7), 0);
});

test("cells outside the wave are dark", () => {
  assert.equal(glyphLevel(0, 0, 4, 7), -1);
  assert.equal(glyphLevel(0, 0, 6, 7), -1);
});

test("the wave comes round again with the period", () => {
  assert.equal(glyphLevel(1, 1, 5, 7), glyphLevel(1, 1, 5 + 7, 7));
  // Never negative modulo, even when the cell is ahead of the frame.
  assert.ok(glyphLevel(4, 4, 0, 7) >= -1);
});
