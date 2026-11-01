import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { zstdCodec, registerZstdCodec } from "./zstd-codec";
import kafkajs from "kafkajs";

// zlib.zstdCompressSync exists on Node >= 22.15; older runtimes skip the round-trip.
const { CompressionCodecs, CompressionTypes } = kafkajs;
const zstdCompress = (zlib as unknown as { zstdCompressSync?: (b: Buffer) => Buffer }).zstdCompressSync;

test("decodes a zstd frame", { skip: !zstdCompress }, async () => {
  const payload = Buffer.from(JSON.stringify({ siteId: "s", events: Array(50).fill({ type: "pageview", path: "/a" }) }));
  const frame = zstdCompress!(payload);
  assert.deepEqual(await zstdCodec.decompress(frame), payload);
});

test("registering installs the codec for kafkajs", () => {
  registerZstdCodec();
  assert.equal(typeof CompressionCodecs[CompressionTypes.ZSTD], "function");
});

test("compress is refused", async () => {
  await assert.rejects(zstdCodec.compress(), /consuming only/);
});
