import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystemObjectStore, assertValidKey } from "./index.js";

async function withStore(run: (store: FileSystemObjectStore, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "gi-objects-"));
  try {
    await run(new FileSystemObjectStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const bytes = (text: string) => new TextEncoder().encode(text);

test("what is put can be read back, and replaced", () =>
  withStore(async (store) => {
    await store.put("site/rel/a.map", bytes("one"));
    assert.equal(new TextDecoder().decode((await store.get("site/rel/a.map"))!), "one");
    await store.put("site/rel/a.map", bytes("two"));
    assert.equal(new TextDecoder().decode((await store.get("site/rel/a.map"))!), "two");
  }));

test("a missing object is null, and deleting it is fine", () =>
  withStore(async (store) => {
    assert.equal(await store.get("site/none.map"), null);
    await store.delete("site/none.map");
  }));

test("listing returns every object under a prefix, with size, and nothing from a sibling prefix", () =>
  withStore(async (store) => {
    await store.put("siteA/r1/x.map", bytes("12345"));
    await store.put("siteA/r2/y.map", bytes("1"));
    await store.put("siteB/r1/z.map", bytes("1"));
    const listed = await store.list("siteA");
    assert.deepEqual(listed.map((o) => [o.key, o.size]).sort(), [["siteA/r1/x.map", 5], ["siteA/r2/y.map", 1]]);
    assert.deepEqual(await store.list("nothing"), []);
  }));

test("keys that could escape the store are refused", () =>
  withStore(async (store) => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a//b", "", "a/./b", "a b", "a\\b", "C:/x"]) {
      assert.throws(() => assertValidKey(bad), /Invalid object key/, JSON.stringify(bad));
      await assert.rejects(store.put(bad, bytes("x")));
    }
  }));

test("a half-written file is never listed", () =>
  withStore(async (store, root) => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "s"), { recursive: true });
    await writeFile(path.join(root, "s", "a.map.abc123.tmp"), "partial");
    assert.deepEqual(await store.list("s"), []);
  }));
