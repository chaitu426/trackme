import { test } from "node:test";
import assert from "node:assert/strict";
import { EngagementClock } from "./engagement.js";

type Listener = () => void;

function setup() {
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;

  const doc = {
    visibilityState: "visible" as "visible" | "hidden",
    listeners: new Map<string, Listener[]>(),
    addEventListener(type: string, fn: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    },
    removeEventListener() {},
  };
  const win = { addEventListener() {}, removeEventListener() {} };
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  g.document = doc;
  g.window = win;

  return {
    advance: (ms: number) => {
      now += ms;
    },
    setVisibility: (state: "visible" | "hidden") => {
      doc.visibilityState = state;
      for (const fn of doc.listeners.get("visibilitychange") ?? []) fn();
    },
    restore: () => {
      Date.now = realNow;
      g.document = saved.document;
      g.window = saved.window;
    },
  };
}

test("active time before a tab hide is still there for the report that follows it", () => {
  const env = setup();
  try {
    const clock = new EngagementClock();
    env.advance(20_000);
    // The clock's own visibilitychange listener runs first, then the tracker's report.
    env.setVisibility("hidden");
    assert.equal(clock.take(), 20_000);
    // Taken once: a second report in the same hide (pagehide) has nothing to add.
    assert.equal(clock.take(), 0);
  } finally {
    env.restore();
  }
});

test("time spent hidden is not counted, and counting resumes when the tab returns", () => {
  const env = setup();
  try {
    const clock = new EngagementClock();
    env.advance(5_000);
    env.setVisibility("hidden");
    assert.equal(clock.take(), 5_000);
    env.advance(600_000);
    assert.equal(clock.take(), 0);
    env.setVisibility("visible");
    env.advance(3_000);
    assert.equal(clock.take(), 3_000);
  } finally {
    env.restore();
  }
});
