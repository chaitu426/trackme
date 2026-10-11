import assert from "node:assert/strict";
import test from "node:test";

import { getSessionId } from "./session";

const originalSessionStorage = globalThis.sessionStorage;
const originalWindow = globalThis.window;

function withSessionStorage(body: () => void) {
  const storage = new Map<string, string>();
  const fakeWindow = {
    sessionStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
      clear() {},
    },
  } as any;

  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: fakeWindow.sessionStorage, configurable: true, writable: true });

  try {
    body();
  } finally {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: originalSessionStorage, configurable: true, writable: true });
  }
}

test("reuses the same session while it is active", () => {
  withSessionStorage(() => {
    const first = getSessionId();
    const second = getSessionId();
    assert.equal(first, second);
  });
});

test("creates a fresh session after 30 minutes of inactivity", () => {
  withSessionStorage(() => {
    const now = Date.now();
    const first = getSessionId();
    const raw = globalThis.sessionStorage.getItem("_gi_sid");
    assert.ok(raw);

    const stale = JSON.stringify({
      id: first,
      createdAt: now - 31 * 60 * 1000,
      lastSeenAt: now - 31 * 60 * 1000,
    });
    globalThis.sessionStorage.setItem("_gi_sid", stale);

    const second = getSessionId();
    assert.notEqual(first, second);
  });
});
