import assert from "node:assert/strict";
import test from "node:test";

import { getSessionId, getSessionSource, getVisitorPseudonym } from "./session";

const originalWindow = globalThis.window;

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  };
}

/** `shared` is localStorage (all tabs); `perTab` is sessionStorage. */
function withBrowser(body: (shared: ReturnType<typeof fakeStorage>) => void, options: { localStorageBlocked?: boolean; allStorageBlocked?: boolean } = {}) {
  const shared = fakeStorage();
  const perTab = fakeStorage();
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const fakeWindow = {
    localStorage: options.localStorageBlocked || options.allStorageBlocked
      ? {
          getItem() {
            throw new Error("blocked");
          },
          setItem() {
            throw new Error("blocked");
          },
        }
      : shared,
    sessionStorage: options.allStorageBlocked ? blocked : perTab,
  } as any;
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
  try {
    body(shared);
  } finally {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
  }
}

test("reuses the same session while it is active", () => {
  withBrowser(() => {
    assert.equal(getSessionId(), getSessionId());
  });
});

test("tabs share one session", () => {
  withBrowser((shared) => {
    const first = getSessionId();
    // Another tab reads the same localStorage record.
    const record = JSON.parse(shared.getItem("_gi_sid")!);
    assert.equal(record.id, first);
    assert.equal(getSessionId(), first);
  });
});

test("creates a fresh session after 30 minutes of inactivity", () => {
  withBrowser((shared) => {
    const now = Date.now();
    const first = getSessionId();
    shared.setItem(
      "_gi_sid",
      JSON.stringify({ id: first, createdAt: now - 31 * 60 * 1000, lastSeenAt: now - 31 * 60 * 1000 })
    );
    assert.notEqual(getSessionId(), first);
  });
});

test("falls back to a per-tab session when localStorage is blocked", () => {
  withBrowser(
    () => {
      // sessionStorage is the fallback only if localStorage throws on read, which it does here;
      // the id still comes back (a new one each call is acceptable, a crash is not).
      assert.ok(getSessionId().length > 8);
    },
    { localStorageBlocked: true }
  );
});

test("the session source is computed once and kept for the whole visit", () => {
  withBrowser(() => {
    let calls = 0;
    const first = getSessionSource(() => {
      calls += 1;
      return { referrer: "https://google.com/", campaign: { source: "newsletter" } };
    });
    const second = getSessionSource(() => {
      calls += 1;
      return {};
    });
    assert.equal(calls, 1);
    assert.deepEqual(second, first);
  });
});

test("a new session gets a new source", () => {
  withBrowser((shared) => {
    getSessionSource(() => ({ referrer: "https://google.com/" }));
    const record = JSON.parse(shared.getItem("_gi_sid")!);
    shared.setItem("_gi_sid", JSON.stringify({ ...record, lastSeenAt: Date.now() - 31 * 60 * 1000 }));
    const next = getSessionSource(() => ({}));
    assert.deepEqual(next, {});
  });
});

test("with all storage blocked the session and visitor stay the same across events", () => {
  withBrowser(
    () => {
      const session = getSessionId();
      const visitor = getVisitorPseudonym();
      assert.equal(getSessionId(), session);
      assert.equal(getVisitorPseudonym(), visitor);
      // One visit, one source, instead of a new one per event.
      let calls = 0;
      const compute = () => {
        calls += 1;
        return { referrer: "https://google.com/" };
      };
      getSessionSource(compute);
      getSessionSource(compute);
      assert.equal(calls, 1);
    },
    { allStorageBlocked: true }
  );
});

test("a corrupt stored session is replaced instead of breaking storage for good", () => {
  withBrowser((shared) => {
    shared.setItem("_gi_sid", "{not json");
    const id = getSessionId();
    assert.equal(JSON.parse(shared.getItem("_gi_sid")!).id, id);
  });
});
