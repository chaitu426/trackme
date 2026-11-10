import { groundAnswer, plan, type ChatClient } from "@trackme/ask";
import type { AskScope, Answer } from "@trackme/ask";

/**
 * Processes one Ask run end to end. Written against small injected interfaces (`RunStore`, `publish`, `plan`) so it runs
 * in a test with no Redis, Postgres or network, and in production with the real ones. The order is: claim → budget →
 * plan (streaming steps) → ground → persist done → publish the final event. Any failure marks the run failed and still
 * publishes a terminal event, so a watching client never hangs.
 */

export interface RunRecord {
  id: string;
  workspaceId: string;
  siteId: string | null;
  question: string;
  scope: AskScope;
}

export interface RunStore {
  /** Read a queued/running run; null when it no longer exists. */
  load(runId: string): Promise<RunRecord | null>;
  markRunning(runId: string): Promise<void>;
  heartbeat(runId: string): Promise<void>;
  markDone(runId: string, answer: Answer, meta: { model: string; tokens: number }): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
}

export type RunPublisher = (event: { type: "step" | "answer" | "error"; [k: string]: unknown }) => Promise<void>;

export interface RunDeps {
  store: RunStore;
  publish: RunPublisher;
  plan: (record: RunRecord, onStep: (step: Answer["steps"][number]) => void) => Promise<{ answer: Answer; tokens: number }>;
  /** Non-blocking admission: returns a release, or null when the workspace is at its concurrency limit. */
  acquireSlot: (workspaceId: string) => Promise<(() => Promise<void>) | null>;
  model: string;
  onResult?: (result: "done" | "failed", ms: number, dropped: number, tokens: number) => void;
}

export async function processRun(runId: string, deps: RunDeps): Promise<"done" | "failed" | "skipped"> {
  const started = Date.now();
  const record = await deps.store.load(runId);
  if (!record) return "skipped";

  const release = await deps.acquireSlot(record.workspaceId);
  if (!release) {
    // The workspace already has its share of runs in flight; another consumer will pick this up later.
    return "skipped";
  }

  try {
    await deps.store.markRunning(runId);
    const beat = setInterval(() => void deps.store.heartbeat(runId).catch(() => undefined), 10_000);
    try {
      const { answer, tokens } = await deps.plan(record, (step) => void deps.publish({ type: "step", step }));
      const grounded = groundAnswer(answer);
      await deps.store.markDone(runId, grounded.answer, { model: deps.model, tokens });
      await deps.publish({ type: "answer", answer: grounded.answer });
      deps.onResult?.("done", Date.now() - started, grounded.dropped.length, tokens);
      return "done";
    } finally {
      clearInterval(beat);
    }
  } catch (err) {
    // The detail (SQL, driver text) stays in the worker log; the person gets a sentence they can act on.
    console.error(`[ask] run ${runId} failed:`, err);
    const message = "Ask could not finish this question. Try again, or ask it another way.";
    await deps.store.markFailed(runId, message).catch(() => undefined);
    await deps.publish({ type: "error", message }).catch(() => undefined);
    deps.onResult?.("failed", Date.now() - started, 0, 0);
    return "failed";
  } finally {
    await release();
  }
}

/** Build the planner bound to a tenant, from the shared package. */
export function plannerFor(chat: ChatClient, limits: { maxTokens: number; maxSteps: number }): RunDeps["plan"] {
  return async (record, onStep) => {
    const tenant = { workspaceId: record.workspaceId, siteId: record.siteId ?? "" };
    const out = await plan({ question: record.question, scope: record.scope, onStep }, { chat, tenant, maxTokens: limits.maxTokens, maxSteps: limits.maxSteps });
    return { answer: out.answer, tokens: out.tokens };
  };
}
