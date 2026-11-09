import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStack } from "./stack.js";

const ORIGIN = "https://shop.test";

test("V8 stacks: named, anonymous, async and constructor frames; the header line is skipped", () => {
  const frames = parseStack(
    [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at onSubmit (https://shop.test/assets/app.js:10:5)",
      "    at https://shop.test/assets/app.js:22:9",
      "    at async handle (https://shop.test/assets/app.js:40:2)",
      "    at new Cart (https://shop.test/assets/cart.js:3:1)",
      "    at Object.dispatch [as fire] (https://cdn.other/lib.js:7:7)",
    ].join("\n"),
    ORIGIN
  );
  assert.deepEqual(
    frames.map((f) => [f.fn, f.file, f.line, f.col, f.inApp]),
    [
      ["onSubmit", "https://shop.test/assets/app.js", 10, 5, true],
      [undefined, "https://shop.test/assets/app.js", 22, 9, true],
      ["handle", "https://shop.test/assets/app.js", 40, 2, true],
      ["new Cart", "https://shop.test/assets/cart.js", 3, 1, true],
      ["Object.dispatch [as fire]", "https://cdn.other/lib.js", 7, 7, false],
    ]
  );
});

test("Firefox and Safari stacks", () => {
  const frames = parseStack(
    ["onSubmit@https://shop.test/assets/app.js:10:5", "@https://shop.test/assets/app.js:22:9", "global code@https://shop.test/a.js:1:1", "[native code]"].join("\n"),
    ORIGIN
  );
  assert.deepEqual(
    frames.map((f) => [f.fn, f.line]),
    [["onSubmit", 10], [undefined, 22], [undefined, 1]]
  );
});

test("query strings and fragments are scrubbed from frame files", () => {
  const [frame] = parseStack("    at pay (https://shop.test/app.js?token=abc#x:5:1)", ORIGIN);
  assert.ok(frame);
  assert.ok(!frame.file.includes("token=abc"));
});

test("node_modules and other origins are not the app's own code", () => {
  const frames = parseStack(
    ["    at a (https://shop.test/node_modules/lib/index.js:1:1)", "    at b (https://elsewhere.test/x.js:1:1)"].join("\n"),
    ORIGIN
  );
  assert.deepEqual(frames.map((f) => f.inApp), [false, false]);
});

test("empty, missing and non-stack text give no frames, and a long stack is capped at 50", () => {
  assert.deepEqual(parseStack(undefined, ORIGIN), []);
  assert.deepEqual(parseStack("", ORIGIN), []);
  assert.deepEqual(parseStack("just some words\nmore words", ORIGIN), []);
  const long = Array.from({ length: 80 }, (_, i) => `    at f${i} (https://shop.test/a.js:${i + 1}:1)`).join("\n");
  assert.equal(parseStack(long, ORIGIN).length, 50);
});

test("a frame without a line number keeps its file", () => {
  const [frame] = parseStack("    at https://shop.test/app.js", ORIGIN);
  assert.equal(frame?.file, "https://shop.test/app.js");
  assert.equal(frame?.line, undefined);
});
