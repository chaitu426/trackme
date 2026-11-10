import type { InsertClient } from "../writers/clickhouse.js";
import type { PreparedErrors } from "./prepare.js";

/** At most this many detailed occurrences are kept per issue per UTC day; the counters still count every one. */
export const OCCURRENCES_PER_GROUP_PER_DAY = 5;
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

/** The part of ioredis the sampler uses, so tests can supply a fake. */
export interface CounterRedis {
  pipeline(): {
    incr(key: string): unknown;
    expire(key: string, seconds: number, mode: "NX"): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
}

export interface ErrorWriterOptions {
  client: InsertClient;
  redis: CounterRedis;
  /** Called when the sampler cannot reach Redis; detail rows are skipped for that batch, counts are not. */
  onSamplerError?: (error: unknown) => void;
}

const dayKey = (ts: string) => ts.slice(0, 10).replace(/-/g, "");

/**
 * Stores a batch's error rows and the sampled detail. The counters (error_events, and through it every
 * aggregate) take every error; only the heavy stack and breadcrumb rows are sampled, by a per-issue
 * per-day Redis counter. Returns how many detail rows were kept.
 */
export function createErrorWriter(options: ErrorWriterOptions): (prepared: PreparedErrors) => Promise<number> {
  const { client, redis, onSamplerError } = options;

  return async ({ rows, occurrences }) => {
    if (rows.length === 0) return 0;

    await client.insert({ table: "error_ingest", values: rows, format: "JSONEachRow" });

    let kept = occurrences;
    try {
      const pipeline = redis.pipeline();
      for (const occurrence of occurrences) {
        const key = `errocc:${occurrence.site_id}:${occurrence.group_id}:${dayKey(occurrence.ts)}`;
        pipeline.incr(key);
        pipeline.expire(key, COUNTER_TTL_SECONDS, "NX");
      }
      const results = (await pipeline.exec()) ?? [];
      kept = occurrences.filter((_, i) => {
        const [error, count] = results[i * 2] ?? [new Error("missing"), 0];
        return !error && Number(count) <= OCCURRENCES_PER_GROUP_PER_DAY;
      });
    } catch (error) {
      onSamplerError?.(error);
      kept = [];
    }

    if (kept.length > 0) {
      await client.insert({ table: "error_occurrences", values: kept, format: "JSONEachRow" });
    }
    return kept.length;
  };
}
