import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectStore } from "@trackme/object-store";
import { runSourceMapRetention, SOURCEMAP_RETENTION_DAYS } from "./sourcemap-retention.js";

const NOW = new Date("2026-11-09T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function fakeStore(objects: Array<{ key: string; modifiedAt: Date }>) {
  const deleted: string[] = [];
  const store: ObjectStore = {
    put: async () => {},
    get: async () => null,
    delete: async (key) => void deleted.push(key),
    list: async (prefix) => objects.filter((o) => o.key.startsWith(prefix)).map((o) => ({ ...o, size: 1 })),
  };
  return { store, deleted };
}

test("maps older than the window are deleted and newer ones kept", async () => {
  const { store, deleted } = fakeStore([
    { key: "sourcemaps/a/1/old.map", modifiedAt: daysAgo(SOURCEMAP_RETENTION_DAYS + 1) },
    { key: "sourcemaps/a/2/edge.map", modifiedAt: daysAgo(SOURCEMAP_RETENTION_DAYS - 1) },
    { key: "sourcemaps/b/3/new.map", modifiedAt: daysAgo(1) },
  ]);
  assert.equal(await runSourceMapRetention(store, NOW), 1);
  assert.deepEqual(deleted, ["sourcemaps/a/1/old.map"]);
});

test("only the sourcemaps prefix is ever touched", async () => {
  const { store, deleted } = fakeStore([{ key: "other/x.bin", modifiedAt: daysAgo(500) }]);
  assert.equal(await runSourceMapRetention(store, NOW), 0);
  assert.deepEqual(deleted, []);
});
