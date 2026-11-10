import { test } from "node:test";
import assert from "node:assert/strict";
import { niceMax, nearestIndex, smoothPath } from "./chart-path";

test("a smooth path starts at the first point and ends at the last", () => {
  const d = smoothPath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 5 }]);
  assert.ok(d.startsWith("M0,10C"));
  assert.ok(d.endsWith("20,5"));
});

test("the curve never leaves the range of the data", () => {
  // A spike followed by a flat run: a plain spline would swing below the flat part.
  const pts = [0, 0, 100, 0, 0].map((y, i) => ({ x: i * 10, y }));
  const d = smoothPath(pts);
  const nums = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(Math.min(...nums) >= 0 && Math.max(...nums) <= 100);
});

test("degenerate inputs do not throw", () => {
  assert.equal(smoothPath([]), "");
  assert.equal(smoothPath([{ x: 1, y: 2 }]), "M1,2");
});

test("axis maximum rounds up to a tidy number", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(73), 100);
  assert.equal(niceMax(180), 200);
  assert.equal(niceMax(2300), 2500);
  assert.equal(niceMax(4100), 5000);
});

test("hover maps to the nearest day", () => {
  assert.equal(nearestIndex(0, 700, 8), 0);
  assert.equal(nearestIndex(700, 700, 8), 7);
  assert.equal(nearestIndex(350, 700, 8), 4);
  assert.equal(nearestIndex(10, 700, 1), 0);
});
