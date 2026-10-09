import { test } from "node:test";
import assert from "node:assert/strict";
import { writeIsolating } from "./isolate.js";
import { DataError, isDataError } from "./errors.js";

/** A sink that refuses any batch containing a value in `bad`, like ClickHouse refusing a row it cannot parse. */
function sinkRejecting(bad: Set<number>, calls: number[][]) {
  return async (batch: number[]) => {
    calls.push(batch);
    if (batch.some((n) => bad.has(n))) throw new DataError("cannot parse row");
  };
}

test("a clean batch is written in one call", async () => {
  const calls: number[][] = [];
  const rejected = await writeIsolating([1, 2, 3, 4], sinkRejecting(new Set(), calls), isDataError);
  assert.deepEqual(rejected, []);
  assert.equal(calls.length, 1);
});

test("one bad row is isolated and every other row is written", async () => {
  const calls: number[][] = [];
  const items = Array.from({ length: 500 }, (_, i) => i);
  const written = new Set<number>();
  const sink = async (batch: number[]) => {
    calls.push(batch);
    if (batch.includes(317)) throw new DataError("bad row");
    batch.forEach((n) => written.add(n));
  };

  const rejected = await writeIsolating(items, sink, isDataError);

  assert.deepEqual(rejected.map((r) => r.item), [317]);
  assert.equal(written.size, 499);
  assert.equal(written.has(317), false);
  // Bisecting 500 rows to find one costs about 2*log2(500) calls, not 500.
  assert.ok(calls.length < 30, `expected a logarithmic number of calls, got ${calls.length}`);
});

test("several bad rows are all isolated", async () => {
  const calls: number[][] = [];
  const rejected = await writeIsolating([1, 2, 3, 4, 5, 6, 7, 8], sinkRejecting(new Set([2, 7]), calls), isDataError);
  assert.deepEqual(rejected.map((r) => r.item).sort(), [2, 7]);
});

test("an infrastructure error is rethrown, not isolated", async () => {
  const calls: number[][] = [];
  const sink = async (batch: number[]) => {
    calls.push(batch);
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(writeIsolating([1, 2, 3, 4], sink, isDataError), /ECONNREFUSED/);
  assert.equal(calls.length, 1, "must not bisect when the database is down");
});

test("isDataError recognises ClickHouse parse codes and ignores server-side failures", () => {
  assert.equal(isDataError(Object.assign(new Error("x"), { code: "41" })), true);
  assert.equal(isDataError(Object.assign(new Error("x"), { code: 117 })), true);
  assert.equal(isDataError(Object.assign(new Error("x"), { code: "241" })), false); // memory limit
  assert.equal(isDataError(Object.assign(new Error("x"), { code: "159" })), false); // timeout
  assert.equal(isDataError(new Error("socket hang up")), false);
  assert.equal(isDataError(null), false);
});
