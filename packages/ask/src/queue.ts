import type { Answer, Step } from "./types.js";

/**
 * The Redis Streams transport between the web route and the ask worker.
 *
 *   ask:runs            one entry per queued run (a run id), consumed by the `ask-workers` group. At-least-once: a run is
 *                       acked only after the worker has written the answer and published its final stream event.
 *   ask:stream:<id>     the live step/answer events for one run, read by the SSE route. Approximate MAXLEN: it is a live
 *                       convenience, and the answer in Postgres is the authoritative fallback when it has aged out.
 */

export const RUNS_STREAM = "ask:runs";
export const GROUP = "ask-workers";
export const RUNS_MAXLEN = 10_000;
const STREAM_MAXLEN = 100;
export const streamKey = (runId: string) => `ask:stream:${runId}`;

/** A step or terminal event written to a run's stream. `done` carries the answer too, as the SSE fallback. */
export type RunEvent =
  | { type: "step"; step: Step }
  | { type: "answer"; answer: Answer }
  | { type: "error"; message: string };

/** The Redis surface the queue needs; a real ioredis client satisfies it. */
export interface QueueRedis {
  xadd(key: string, ...args: Array<string | number>): Promise<unknown>;
  xgroup(...args: Array<string | number>): Promise<unknown>;
  xreadgroup(...args: Array<string | number>): Promise<unknown>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
  xautoclaim(...args: Array<string | number>): Promise<unknown>;
  xrange(key: string, start: string, end: string, ...args: Array<string | number>): Promise<unknown>;
}

/** Enqueue a run id for a worker to pick up. */
export async function enqueue(redis: QueueRedis, runId: string): Promise<void> {
  await redis.xadd(RUNS_STREAM, "MAXLEN", "~", RUNS_MAXLEN, "*", "runId", runId);
}

/** Create the consumer group once; `MKSTREAM` makes the first call safe on an empty Redis. */
export async function ensureGroup(redis: QueueRedis, stream: string = RUNS_STREAM): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, GROUP, "0", "MKSTREAM");
  } catch (err) {
    // BUSYGROUP means it already exists, which is the success case.
    if (!String((err as Error)?.message ?? err).includes("BUSYGROUP")) throw err;
  }
}

/** Publish one event to a run's live stream. */
export async function publish(redis: QueueRedis, runId: string, event: RunEvent): Promise<void> {
  await redis.xadd(
    streamKey(runId),
    "MAXLEN",
    "~",
    STREAM_MAXLEN,
    "*",
    "type",
    event.type,
    "data",
    JSON.stringify(event)
  );
}

/** Replay a run's live events from the start, for an SSE client that just connected. */
export async function replay(redis: QueueRedis, runId: string): Promise<RunEvent[]> {
  const raw = await redis.xrange(streamKey(runId), "-", "+");
  return parseEntries(raw);
}

/**
 * Parse `XREAD BLOCK ... STREAMS key <fromId>` output. Redis answers `[[key, [[id, fields], ...]], ...]`; the web SSE route
 * reads a run's stream this way after replaying it, so a step published between the replay and the first read is not missed.
 */
export function parseReadReply(raw: unknown): Array<{ id: string; event: RunEvent }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; event: RunEvent }> = [];
  for (const stream of raw as Array<[string, Array<[string, string[]]>]>) {
    for (const entry of stream?.[1] ?? []) {
      const fields = Array.isArray(entry?.[1]) ? entry[1] : [];
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === "data") {
          try {
            out.push({ id: String(entry[0]), event: JSON.parse(String(fields[i + 1])) as RunEvent });
          } catch {
            // skip a malformed entry
          }
        }
      }
    }
  }
  return out;
}

/** ioredis returns `[[id, [field, value, ...]], ...]`; accept that tuple shape and pull the JSON `data` field. */
function parseEntries(raw: unknown): RunEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: RunEvent[] = [];
  for (const entry of raw as Array<[string, string[]]>) {
    const fields = Array.isArray(entry?.[1]) ? entry[1] : [];
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === "data") {
        try {
          out.push(JSON.parse(String(fields[i + 1])) as RunEvent);
        } catch {
          // skip a malformed entry; the answer fallback still covers the client
        }
      }
    }
  }
  return out;
}
