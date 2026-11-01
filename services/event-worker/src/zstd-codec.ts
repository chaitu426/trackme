import kafkajs from "kafkajs";
import { decompress } from "fzstd";

// kafkajs is CommonJS and only some of its exports are visible as ESM named imports.
const { CompressionCodecs, CompressionTypes } = kafkajs;

/**
 * kafkajs reads gzip only. The Go edge compresses with zstd (KAFKA_COMPRESSION), so the
 * consumer needs a zstd decoder or every fetched batch fails with "ZSTD compression
 * not implemented". This is decode-only (pure JS, no native build): the worker never
 * produces compressed batches, and compress() fails loudly if that ever changes.
 */
export const zstdCodec = {
  async compress(): Promise<Buffer> {
    throw new Error("zstd compression is not supported by this worker; use it for consuming only");
  },
  async decompress(buffer: Buffer): Promise<Buffer> {
    const out = decompress(buffer);
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  },
};

export function registerZstdCodec(): void {
  CompressionCodecs[CompressionTypes.ZSTD] = () => zstdCodec;
}
