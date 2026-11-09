import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadChunk, rememberScript } from "./lazy.js";

// lazy.ts reads __CHUNKS__ (a build-time constant) when a chunk is requested; tests supply it as a global.
(globalThis as Record<string, unknown>).__CHUNKS__ = { vitals: { f: "tracker.vitals.abc12345.js", i: "sha384-HASH" } };

type FakeScript = {
  src?: string;
  integrity?: string;
  crossOrigin?: string;
  async?: boolean;
  onload?: () => void;
  onerror?: () => void;
  _gi?: unknown;
};

function installDocument(outcome: "load" | "error" | "throw", api?: unknown) {
  const appended: FakeScript[] = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({}) as FakeScript,
    head: {
      appendChild: (script: FakeScript) => {
        if (outcome === "throw") throw new Error("blocked");
        appended.push(script);
        queueMicrotask(() => {
          if (outcome === "load") {
            script._gi = api;
            script.onload?.();
          } else {
            script.onerror?.();
          }
        });
      },
    },
  };
  return appended;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  rememberScript(null);
});

test("a chunk is fetched from beside the script that loaded the tracker, and hands back its API", async () => {
  const appended = installDocument("load", { observeWebVitals: () => {} });
  rememberScript({ src: "https://cdn.test/t/0.1.0/tracker.0.1.0.deadbeef.js", integrity: "" } as HTMLScriptElement);

  const api = await loadChunk<{ observeWebVitals: () => void }>("vitals");

  assert.equal(appended.length, 1);
  assert.equal(appended[0]!.src, "https://cdn.test/t/0.1.0/tracker.vitals.abc12345.js");
  assert.equal(appended[0]!.async, true);
  assert.equal(typeof api?.observeWebVitals, "function");
});

test("when the page pinned tracker.js with integrity, the chunk is pinned too", async () => {
  const appended = installDocument("load", {});
  rememberScript({ src: "https://cdn.test/tracker.js", integrity: "sha384-main" } as HTMLScriptElement);
  await loadChunk("vitals");
  assert.equal(appended[0]!.integrity, "sha384-HASH");
  assert.equal(appended[0]!.crossOrigin, "anonymous");
});

test("without integrity on the page, no integrity or crossorigin is forced on the chunk", async () => {
  const appended = installDocument("load", {});
  rememberScript({ src: "https://cdn.test/tracker.js", integrity: "" } as HTMLScriptElement);
  await loadChunk("vitals");
  assert.equal(appended[0]!.integrity, undefined);
  assert.equal(appended[0]!.crossOrigin, undefined);
});

test("a chunk that fails to load resolves null instead of throwing", async () => {
  installDocument("error");
  rememberScript({ src: "https://cdn.test/tracker.js", integrity: "" } as HTMLScriptElement);
  assert.equal(await loadChunk("vitals"), null);
});

test("a blocked insert, an unknown chunk and a missing loader tag all resolve null", async () => {
  installDocument("throw");
  rememberScript({ src: "https://cdn.test/tracker.js", integrity: "" } as HTMLScriptElement);
  assert.equal(await loadChunk("vitals"), null);

  installDocument("load", {});
  assert.equal(await loadChunk("nope"), null);

  rememberScript(null);
  assert.equal(await loadChunk("vitals"), null);
});
