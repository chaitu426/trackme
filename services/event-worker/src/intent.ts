import type { Redis } from "ioredis";

/**
 * Exact replay for the ClickHouse insert-deduplication token.
 *
 * The token (a hash of the batch's event ids) only dedupes a redelivered batch if the
 * redelivery has the SAME members. Kafka does not promise that: after a crash the fetch
 * may cut the stream at different offsets. So before inserting we record the offset range
 * [first, last] we are about to insert; after a restart the first batch for that partition
 * is cut back to exactly that range, giving the same rows and therefore the same token.
 * The range is cleared only after the offset commit, so at most one range per partition
 * is ever in flight (offsets are committed after every batch, see worker.ts).
 *
 * Same idea as the intent state in ClickHouse's own Kafka Connect sink.
 */
export type Range = { first: string; last: string };

const key = (group: string, partition: number) => `worker:intent:${group}:${partition}`;

/**
 * The worker's Redis client queues commands forever while Redis is down (maxRetriesPerRequest: null,
 * right for the realtime view). The writer must not inherit that: a wait here would outlast the
 * Kafka session timeout and trigger a rebalance loop. A timeout turns "Redis is down" into the
 * documented degradation: the batch proceeds without an exact-replay guarantee.
 */
const INTENT_TIMEOUT_MS = 500;
const within = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("intent store timeout")), INTENT_TIMEOUT_MS).unref())]);

export async function readIntent(redis: Redis, group: string, partition: number): Promise<Range | null> {
  const raw = await within(redis.get(key(group, partition)));
  const [first, last] = raw?.split("-") ?? [];
  return first && last ? { first, last } : null;
}

export const writeIntent = (redis: Redis, group: string, partition: number, r: Range) =>
  within(redis.set(key(group, partition), `${r.first}-${r.last}`));

export const clearIntent = (redis: Redis, group: string, partition: number) => within(redis.del(key(group, partition)));

/**
 * The messages to process: cut back to the recorded range when the batch starts exactly where
 * that range started; otherwise (no record, or a stale one from a range already committed) the
 * whole batch. Offsets are compared as BigInt because Kafka offsets exceed 2^53 in theory.
 */
export function pin<M extends { offset: string }>(messages: M[], intent: Range | null): M[] {
  if (!intent || messages.length === 0 || messages[0]!.offset !== intent.first) return messages;
  const last = BigInt(intent.last);
  return messages.filter((m) => BigInt(m.offset) <= last);
}
