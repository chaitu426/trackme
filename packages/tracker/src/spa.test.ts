import { test } from "node:test";
import assert from "node:assert/strict";
import { listenToRouteChanges } from "./spa.js";

test("spa route tracking composes with other history patches and can be disabled cleanly", () => {
  const calls: string[] = [];
  let nextFrame: (() => void) | null = null;
  let currentPath = "/initial";

  const historyState = {
    pushState: (() => {
      calls.push("base-push");
    }) as typeof history.pushState,
    replaceState: (() => {
      calls.push("base-replace");
    }) as typeof history.replaceState,
  };

  const win = {
    location: {
      get pathname() {
        return currentPath;
      },
      set pathname(value: string) {
        currentPath = value;
      },
      get search() {
        return "";
      },
    },
    requestAnimationFrame: (fn: () => void) => {
      nextFrame = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      nextFrame = null;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as typeof window;

  Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, "history", { value: historyState, configurable: true, writable: true });

  const basePushState = historyState.pushState.bind(historyState);
  historyState.pushState = function (...args) {
    calls.push("before-patch");
    const result = basePushState.apply(this, args);
    calls.push("before-after");
    return result;
  } as typeof history.pushState;

  const stop = listenToRouteChanges((newPath, previousPath) => {
    calls.push(`tracker:${previousPath}->${newPath}`);
  });

  const currentPushState = historyState.pushState;
  historyState.pushState = function (...args) {
    calls.push("after-before");
    const result = currentPushState.apply(this, args);
    calls.push("after-after");
    return result;
  } as typeof history.pushState;

  currentPath = "/next";
  historyState.pushState("state", "title", "/next");
  nextFrame?.();

  assert.ok(calls.includes("tracker:/initial->/next"), "expected the tracker callback to fire once");
  assert.ok(calls.includes("before-patch"), "expected earlier wrappers to still run");
  assert.ok(calls.includes("after-before"), "expected later wrappers to still run");

  stop();
  currentPath = "/third";
  historyState.pushState("state", "title", "/third");
  nextFrame?.();

  assert.equal(calls.filter((entry) => entry.startsWith("tracker:")).length, 1, "listener should be disabled after unlisten");
  assert.ok(historyState.pushState !== undefined);
});
