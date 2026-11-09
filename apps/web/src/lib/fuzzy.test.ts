import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

test("letters must appear in order", () => {
  assert.notEqual(fuzzyScore("rtm", "Realtime"), null);
  assert.equal(fuzzyScore("mtr", "Realtime"), null);
  assert.equal(fuzzyScore("xyz", "Realtime"), null);
});

test("an empty query matches everything and keeps the order", () => {
  assert.deepEqual(fuzzyFilter(["b", "a"], "  ", (s) => s), ["b", "a"]);
});

test("case and accents are ignored", () => {
  assert.notEqual(fuzzyScore("REAL", "realtime"), null);
  assert.notEqual(fuzzyScore("cafe", "Café"), null);
});

test("a prefix beats a scattered match", () => {
  const out = fuzzyFilter(["Audience Geography", "Goals & Events", "Gateway Health"], "ga", (s) => s);
  assert.equal(out[0], "Gateway Health");
});

test("word starts rank above mid-word letters", () => {
  const out = fuzzyFilter(["Page Performance", "Acquisition", "Web Vitals"], "wv", (s) => s);
  assert.deepEqual(out, ["Web Vitals"]);
  const two = fuzzyFilter(["Checkout Funnel", "Funnels"], "fun", (s) => s);
  assert.equal(two[0], "Funnels");
});

test("ties keep the original order", () => {
  assert.deepEqual(fuzzyFilter(["Alpha", "Alpha"], "al", (s) => s), ["Alpha", "Alpha"]);
});
