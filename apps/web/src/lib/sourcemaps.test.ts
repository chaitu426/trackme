import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SourceMapGenerator } from "source-map";
import type { ObjectStore } from "@trackme/object-store";
import { checkSourceMap, cleanSource, clearSourceMapCache, mapKey, normalizeFileKey, symbolicate } from "./sourcemaps";

const SITE = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

function memoryStore() {
  const data = new Map<string, Uint8Array>();
  const store: ObjectStore = {
    put: async (key, bytes) => void data.set(key, bytes),
    get: async (key) => data.get(key) ?? null,
    delete: async (key) => void data.delete(key),
    list: async () => [],
  };
  return { store, data };
}

/** Generated code `a` at line 1 col 10 came from src/pay.ts line 42 col 4, function submitOrder. */
function buildMap(): string {
  const generator = new SourceMapGenerator({ file: "app.js" });
  generator.addMapping({
    generated: { line: 1, column: 10 },
    original: { line: 42, column: 4 },
    source: "webpack://shop/./src/pay.ts",
    name: "submitOrder",
  });
  generator.addMapping({
    generated: { line: 1, column: 80 },
    original: { line: 7, column: 0 },
    source: "webpack://shop/./node_modules/lib/index.js",
  });
  return generator.toString();
}

beforeEach(() => clearSourceMapCache());

test("a file is found by its path, whatever the host, query or fragment", () => {
  assert.equal(normalizeFileKey("https://cdn.test/assets/app.3f2a.js?v=1#x"), "/assets/app.3f2a.js");
  assert.equal(normalizeFileKey("/assets/app.3f2a.js"), "/assets/app.3f2a.js");
  assert.equal(normalizeFileKey("assets/app.js"), "/assets/app.js");
  assert.equal(mapKey(SITE, "web@1", "https://a.test/x.js"), mapKey(SITE, "web@1", "https://b.test/x.js?q=1"));
});

test("a map belongs to one site and one release", () => {
  assert.notEqual(mapKey(SITE, "web@1", "/x.js"), mapKey(SITE, "web@2", "/x.js"));
  assert.notEqual(mapKey(SITE, "web@1", "/x.js"), mapKey(OTHER, "web@1", "/x.js"));
  assert.ok(mapKey(SITE, "web@1", "/x.js").startsWith(`sourcemaps/${SITE}/`));
  assert.match(mapKey(SITE, "we b/../@1", "/x.js"), /^[A-Za-z0-9._=/-]+$/, "any release text yields a safe key");
});

test("only real version 3 maps are accepted", () => {
  assert.equal(checkSourceMap(buildMap()).ok, true);
  for (const bad of ["not json", "{}", '{"version":2,"sources":[],"mappings":""}', '{"version":3,"sources":"x","mappings":""}', "null", "[]"]) {
    assert.equal(checkSourceMap(bad).ok, false, bad);
  }
  assert.equal(checkSourceMap(" ".repeat(10 * 1024 * 1024 + 1)).ok, false);
});

test("bundler prefixes are dropped from source paths", () => {
  assert.equal(cleanSource("webpack://shop/./src/pay.ts"), "src/pay.ts");
  assert.equal(cleanSource("./src/a.ts"), "src/a.ts");
  assert.equal(cleanSource("vite://app/src/b.ts?x=1"), "src/b.ts");
  assert.equal(cleanSource("src/c.ts"), "src/c.ts");
});

test("minified frames become the original file, line and column", async () => {
  const { store } = memoryStore();
  await store.put(mapKey(SITE, "web@1", "/assets/app.js"), new TextEncoder().encode(buildMap()));
  const { frames, mapped } = await symbolicate(
    SITE,
    "web@1",
    [
      { fn: "a", file: "https://cdn.test/assets/app.js?v=3", line: 1, col: 11, inApp: true },
      { fn: "z", file: "https://cdn.test/assets/app.js", line: 1, col: 81, inApp: true },
    ],
    store
  );
  assert.equal(mapped, 2);
  assert.deepEqual([frames[0]!.file, frames[0]!.line, frames[0]!.col], ["src/pay.ts", 42, 5]);
  assert.equal(frames[1]!.file, "node_modules/lib/index.js");
  assert.equal(frames[1]!.inApp, false);
});

test("a frame is named after what its caller calls, not after the name at its own position", async () => {
  const { store } = memoryStore();
  await store.put(mapKey(SITE, "web@1", "/assets/app.js"), new TextEncoder().encode(buildMap()));
  // Frame 1 (the caller) sits on the call to `submitOrder`, so frame 0 is submitOrder; frame 1 has no caller to name it.
  const { frames } = await symbolicate(
    SITE,
    "web@1",
    [
      { fn: "r", file: "/assets/app.js", line: 1, col: 81 },
      { fn: "e", file: "/assets/app.js", line: 1, col: 11 },
    ],
    store
  );
  assert.equal(frames[0]!.fn, "submitOrder");
  assert.equal(frames[1]!.fn, "e", "the reported name stays when no caller frame can name it");
});

test("without a map, for another release, or for another site, frames stay as reported", async () => {
  const { store } = memoryStore();
  await store.put(mapKey(SITE, "web@1", "/assets/app.js"), new TextEncoder().encode(buildMap()));
  const frame = { fn: "a", file: "https://cdn.test/assets/app.js", line: 1, col: 11, inApp: true };
  for (const [site, release] of [[SITE, "web@2"], [OTHER, "web@1"], [SITE, ""]] as const) {
    const out = await symbolicate(site, release, [frame], store);
    assert.deepEqual(out, { frames: [frame], mapped: 0 }, `${site} ${release}`);
  }
});

test("a corrupt stored map and a frame the map cannot place both fall back to the raw frame", async () => {
  const { store } = memoryStore();
  await store.put(mapKey(SITE, "web@1", "/bad.js"), new TextEncoder().encode("{broken"));
  await store.put(mapKey(SITE, "web@1", "/assets/app.js"), new TextEncoder().encode(buildMap()));
  const bad = { fn: "a", file: "/bad.js", line: 1, col: 1 };
  const unplaceable = { fn: "q", file: "/assets/app.js", line: 99, col: 1 };
  const noLine = { fn: "n", file: "/assets/app.js" };
  const out = await symbolicate(SITE, "web@1", [bad, unplaceable, noLine], store);
  assert.deepEqual(out, { frames: [bad, unplaceable, noLine], mapped: 0 });
});
