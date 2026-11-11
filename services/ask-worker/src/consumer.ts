import { Redis } from "ioredis";
import { env } from "@trackme/config";
import {
  GROUP,
  RUNS_STREAM,
  ensureGroup,
  publish,
  enqueue,
  acquireWorkspaceSlot,
  openAiChatClient,
  type QueueRedis,
  type BudgetRedis,
} from "@trackme/ask";
import { processRun, plannerFor, rateLimited, type RunDeps } from "./run.js";
import { createRunStore, requeueStale } from "./store.js";
import { droppedBlocks, lastSuccess, plannerTokens, runDuration, runsTotal } from "./metrics.js";

/**
 * The ask worker's main loop. It joins the `ask-workers` consumer group, reclaims anything a crashed consumer left
 * pending, then blocks on new run ids. Each run is processed by `processRun` with a planner bound to that run's tenant and
 * the shared OpenAI client. A run is acked only after its answer (or failure) is written, so a crash re-delivers it.
 */

export interface ConsumerOptions {
  redis: Redis;
  consumerName: string;
  // The surface `processRun` needs; the real ones are built in `main.ts`.
  deps: (runId: string) => Promise<RunDeps>;
  signal: AbortSignal;
  blockMs?: number;
}

type StreamReply = Array<[string, Array<[string, string[]]>]> | null;

/** Pull `runId` out of an entry's flat [field, value, ...] list. */
function runIdOf(fields: string[]): string | null {
  for (let i = 0; i < fields.length; i += 2) if (fields[i] === "runId") return fields[i + 1] ?? null;
  return null;
}

export async function consume(options: ConsumerOptions): Promise<void> {
  const { redis, consumerName, deps, signal } = options;
  const blockMs = options.blockMs ?? 5_000;
  const queue = redis as unknown as QueueRedis;
  await ensureGroup(queue);
  await reclaimPending(redis, consumerName, deps);

  while (!signal.aborted) {
    let reply: StreamReply;
    try {
      reply = (await redis.xreadgroup("GROUP", GROUP, consumerName, "COUNT", 10, "BLOCK", blockMs, "STREAMS", RUNS_STREAM, ">")) as StreamReply;
    } catch (err) {
      if (signal.aborted) break;
      console.error("ask worker: xreadgroup failed:", err);
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    if (!reply) continue;
    for (const [, entries] of reply) {
      for (const [entryId, fields] of entries) {
        const runId = runIdOf(fields);
        if (runId) await handle(redis, consumerName, entryId, runId, deps);
        else await redis.xack(RUNS_STREAM, GROUP, entryId);
      }
    }
  }
}

async function handle(redis: Redis, _consumer: string, entryId: string, runId: string, deps: (id: string) => Promise<RunDeps>): Promise<void> {
  try {
    const result = await processRun(runId, await deps(runId));
    if (result === "done") {
      lastSuccess.set(Date.now() / 1000);
    } else if (result === "busy") {
      // The workspace is at its concurrency limit. Acking alone would drop the run (it would sit "queued" until the sweeper
      // gave up on it), so put it back on the stream after a short, jittered pause and ack this delivery.
      runsTotal.inc({ result: "busy" });
      const again = setTimeout(() => void enqueue(redis as unknown as QueueRedis, runId).catch((e) => console.error("ask worker: re-enqueue failed:", e)), 2_000 + Math.random() * 2_000);
      again.unref?.();
    } else if (result === "skipped") {
      runsTotal.inc({ result });
    }
  } catch (err) {
    // processRun marks the run failed itself; a throw here is a store failure, so leave the entry pending to retry.
    console.error(`ask worker: run ${runId} threw:`, err);
    return;
  }
  await redis.xack(RUNS_STREAM, GROUP, entryId);
}

/** Reclaim entries another consumer read but never acked (it crashed), and process them again. */
async function reclaimPending(redis: Redis, consumerName: string, deps: (id: string) => Promise<RunDeps>): Promise<void> {
  let cursor = "0-0";
  for (;;) {
    const reply = (await redis.xautoclaim(RUNS_STREAM, GROUP, consumerName, 60_000, cursor, "COUNT", 20)) as [string, Array<[string, string[]]>, string[]];
    const [, entries] = reply;
    for (const [entryId, fields] of entries ?? []) {
      const runId = runIdOf(fields);
      if (runId) await handle(redis, consumerName, entryId, runId, deps);
      else await redis.xack(RUNS_STREAM, GROUP, entryId);
    }
    cursor = reply[0];
    if (cursor === "0-0" || (entries ?? []).length === 0) break;
  }
}

/** Build the per-run dependency bundle once per process: a shared OpenAI client, the store, and a publisher bound to the run. */
export function createDepsFactory(
  redis: Redis,
  opts: { model: string; maxTokens: number; maxSteps: number; apiKey: string }
): (runId: string) => Promise<RunDeps> {
  const store = createRunStore();
  const budget = redis as unknown as BudgetRedis;
  const chat = rateLimited(openAiChatClient(opts.apiKey, opts.model), budget, env.ASK_LLM_RPM);
  return async (runId: string) => {
    const publishForRun: RunDeps["publish"] = (event) => publish(redis as unknown as QueueRedis, runId, event as never);
    return {
      store,
      publish: publishForRun,
      plan: plannerFor(chat, opts),
      acquireSlot: (workspaceId: string) => acquireWorkspaceSlot(budget, workspaceId, env.ASK_WORKSPACE_CONCURRENCY),
      model: opts.model,
      onResult: (result: "done" | "failed" | "cancelled", ms: number, dropped: number, tokens: number) => {
        runsTotal.inc({ result });
        runDuration.observe(ms / 1000);
        if (dropped) droppedBlocks.inc(dropped);
        if (tokens) plannerTokens.inc(tokens);
      },
    };
  };
}

/** Put runs the sweeper reset back on the stream so a worker picks them up. */
export async function reenqueue(redis: Redis, runIds: string[]): Promise<void> {
  for (const id of runIds) await enqueue(redis as unknown as QueueRedis, id);
}

export { requeueStale };
