import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorPayload } from "@trackme/contracts";
import { createReporter, DEDUPE_MS, MAX_CRUMBS, MAX_TAGS, SESSION_CAP } from "./reporter.js";

function setup(startCount = 0) {
  const sent: ErrorPayload[] = [];
  let clock = 1_000_000;
  let count = startCount;
  const reporter = createReporter({
    send: (p) => sent.push(p),
    origin: "https://shop.test",
    now: () => clock,
    session: { get: () => count, set: (n) => (count = n) },
  });
  return { reporter, sent, tick: (ms: number) => (clock += ms), count: () => count };
}

const boom = { type: "TypeError", message: "x is undefined", stack: "    at pay (https://shop.test/app.js:1:1)" };

test("an error is sent with its frames, scrubbed message and level", () => {
  const { reporter, sent } = setup();
  assert.equal(reporter.capture({ ...boom, message: "failed for ada@example.com" }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.message, "failed for [email]");
  assert.equal(sent[0]!.level, "error");
  assert.equal(sent[0]!.frames![0]!.inApp, true);
});

test("the same error inside ten seconds is sent once, and again after", () => {
  const { reporter, sent, tick } = setup();
  reporter.capture(boom);
  tick(DEDUPE_MS - 1);
  assert.equal(reporter.capture(boom), false);
  tick(2);
  assert.equal(reporter.capture(boom), true);
  assert.equal(sent.length, 2);
});

test("a different error is not deduplicated against another", () => {
  const { reporter, sent } = setup();
  reporter.capture(boom);
  reporter.capture({ ...boom, message: "y is undefined" });
  assert.equal(sent.length, 2);
});

test("a session sends at most 50 errors, counting ones from earlier pages", () => {
  const { reporter, sent, tick, count } = setup(SESSION_CAP - 2);
  for (let i = 0; i < 5; i += 1) {
    reporter.capture({ ...boom, message: `error ${i}` });
    tick(1);
  }
  assert.equal(sent.length, 2);
  assert.equal(count(), SESSION_CAP);
});

test("breadcrumbs keep the last 20, in order, scrubbed and capped at 200 characters", () => {
  const { reporter, sent } = setup();
  for (let i = 0; i < 30; i += 1) reporter.addCrumb("log", `step ${i}`);
  reporter.addCrumb("fetch", `GET /api?card=4242424242424242 ${"x".repeat(300)}`);
  reporter.capture(boom);
  const crumbs = sent[0]!.breadcrumbs!;
  assert.equal(crumbs.length, MAX_CRUMBS);
  assert.equal(crumbs[0]!.m, "step 11");
  const last = crumbs[crumbs.length - 1]!;
  assert.ok(!last.m.includes("4242424242424242"));
  assert.ok(last.m.length <= 200);
});

test("tags are validated, scrubbed and limited to ten; per-call tags are merged in", () => {
  const { reporter, sent } = setup();
  for (let i = 0; i < 15; i += 1) reporter.setTag(`tag${i}`, "v");
  reporter.setTag("bad key!", "v");
  reporter.setTag("tag0", "ada@example.com");
  reporter.capture({ ...boom, tags: { extra: "1" } });
  const tags = sent[0]!.tags!;
  assert.equal(Object.keys(tags).length, MAX_TAGS);
  assert.equal(tags.tag0, "[email]");
  assert.ok(!("bad key!" in tags));
});

test("with no stack, the event's own file and line become the frame", () => {
  const { reporter, sent } = setup();
  reporter.capture({ type: "Error", message: "boom", frame: { file: "https://shop.test/app.js", line: 9, col: 3 } });
  assert.deepEqual(sent[0]!.frames, [{ file: "https://shop.test/app.js", line: 9, col: 3, inApp: true }]);
});

test("a custom fingerprint and level pass through", () => {
  const { reporter, sent } = setup();
  reporter.capture({ ...boom, fingerprint: "checkout-null-user", level: "fatal" });
  assert.equal(sent[0]!.fingerprint, "checkout-null-user");
  assert.equal(sent[0]!.level, "fatal");
});

test("a failing send never throws into the host app", () => {
  const reporter = createReporter({
    send: () => {
      throw new Error("transport broke");
    },
    origin: "https://shop.test",
    session: { get: () => 0, set: () => {} },
  });
  assert.doesNotThrow(() => reporter.capture(boom));
});
