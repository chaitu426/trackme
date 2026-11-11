import {
  AskFailure,
  classifyFailure,
  fallbackAnswer,
  groundAnswer,
  plan,
  takeRpmToken,
  type BudgetRedis,
  type ChatClient,
} from "@trackme/ask";
import type { AskScope, Answer } from "@trackme/ask";

/**
 * Processes one Ask run end to end. Written against small injected interfaces (`RunStore`, `publish`, `plan`) so it runs
 * in a test with no Redis, Postgres or network, and in production with the real ones. The order is: load → admit → plan
 * (streaming steps, stoppable) → ground → persist done → publish the final event. Any failure marks the run failed and
 * still publishes a terminal event, so a watching client never hangs, and the message says what actually went wrong.
 */

export interface RunRecord {
  id: string;
  workspaceId: string;
  siteId: string | null;
  question: string;
  scope: AskScope;
  /** queued | running | done | failed | cancelled. A redelivered run that is already finished is not run again. */
  status?: string;
}

export interface RunStore {
  /** Read a queued/running run; null when it no longer exists. */
  load(runId: string): Promise<RunRecord | null>;
  markRunning(runId: string): Promise<void>;
  heartbeat(runId: string): Promise<void>;
  markDone(runId: string, answer: Answer, meta: { model: string; tokens: number }): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  /** True once the person has asked to stop this run. */
  isCancelled(runId: string): Promise<boolean>;
  markCancelled(runId: string): Promise<void>;
}

export type RunPublisher = (event: { type: "step" | "answer" | "error"; [k: string]: unknown }) => Promise<void>;

export interface PlanControl {
  /** Throws `AskFailure` when the run was cancelled or ran past its deadline; resolves false otherwise. */
  shouldStop: () => Promise<boolean>;
}

export interface RunDeps {
  store: RunStore;
  publish: RunPublisher;
  plan: (
    record: RunRecord,
    onStep: (step: Answer["steps"][number]) => void,
    control: PlanControl
  ) => Promise<{ answer: Answer; tokens: number; derived?: string[]; allowed?: string[] }>;
  /** Non-blocking admission: returns a release, or null when the workspace is at its concurrency limit. */
  acquireSlot: (workspaceId: string) => Promise<(() => Promise<void>) | null>;
  model: string;
  /** Wall-clock budget for one run, however many model calls it makes. Defaults to 150 s. */
  deadlineMs?: number;
  onResult?: (result: "done" | "failed" | "cancelled", ms: number, dropped: number, tokens: number) => void;
}

export type RunOutcome = "done" | "failed" | "cancelled" | "skipped" | "busy";

const FINISHED = new Set(["done", "failed", "cancelled"]);

export async function processRun(runId: string, deps: RunDeps): Promise<RunOutcome> {
  const started = Date.now();
  const record = await deps.store.load(runId);
  if (!record) return "skipped";
  // At-least-once delivery means a finished run can come around again; it must not spend tokens twice.
  if (record.status && FINISHED.has(record.status)) return "skipped";

  const release = await deps.acquireSlot(record.workspaceId);
  if (!release) return "busy";

  const deadline = started + (deps.deadlineMs ?? 150_000);
  const control: PlanControl = {
    shouldStop: async () => {
      if (Date.now() > deadline) throw new AskFailure("timeout", "This took longer than allowed. Try a narrower question or a shorter range.");
      return deps.store.isCancelled(runId);
    },
  };

  try {
    await deps.store.markRunning(runId);
    const beat = setInterval(() => void deps.store.heartbeat(runId).catch(() => undefined), 10_000);
    try {
      const out = await deps.plan(record, (step) => void deps.publish({ type: "step", step }), control);
      const grounded = groundAnswer(out.answer, { derived: out.derived ?? [], allowed: out.allowed ?? [] });
      // Never end "done" with nothing to show: if the gate removed every block, show the evidence itself.
      const finalAnswer = grounded.grounded ? grounded.answer : fallbackAnswer(grounded.answer, grounded.dropped);
      await deps.store.markDone(runId, finalAnswer, { model: deps.model, tokens: out.tokens });
      await deps.publish({ type: "answer", answer: finalAnswer });
      deps.onResult?.("done", Date.now() - started, grounded.dropped.length, out.tokens);
      return "done";
    } finally {
      clearInterval(beat);
    }
  } catch (err) {
    const failure = classifyFailure(err);
    // The detail (SQL, driver text, provider body) stays in the worker log; the person gets a sentence they can act on.
    console.error(`[ask] run ${runId} ${failure.code}:`, err);
    if (failure.code === "cancelled") {
      await deps.store.markCancelled(runId).catch(() => undefined);
      await deps.publish({ type: "error", message: failure.message }).catch(() => undefined);
      deps.onResult?.("cancelled", Date.now() - started, 0, 0);
      return "cancelled";
    }
    await deps.store.markFailed(runId, failure.message).catch(() => undefined);
    await deps.publish({ type: "error", message: failure.message }).catch(() => undefined);
    deps.onResult?.("failed", Date.now() - started, 0, 0);
    return "failed";
  } finally {
    await release();
  }
}

/**
 * Wraps a chat client so every completion first takes a token from the fleet-wide per-minute bucket (`ASK_LLM_RPM`),
 * waiting briefly when the minute's allowance is spent. Without this the limit the web route pre-checks was never enforced.
 */
export function rateLimited(chat: ChatClient, redis: BudgetRedis, rpm: number, maxWaitMs = 20_000): ChatClient {
  return {
    async complete(messages, tools, maxTokens, options) {
      const until = Date.now() + maxWaitMs;
      while (!(await takeRpmToken(redis, rpm))) {
        if (Date.now() >= until) throw Object.assign(new Error("fleet rate limit"), { status: 429 });
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
      }
      return chat.complete(messages, tools, maxTokens, options);
    },
  };
}

/** Build the planner bound to a tenant, from the shared package. */
export function plannerFor(chat: ChatClient, limits: { maxTokens: number; maxSteps: number }): RunDeps["plan"] {
  return async (record, onStep, control) => {
    const tenant = { workspaceId: record.workspaceId, siteId: record.siteId ?? "" };
    const out = await plan(
      { question: record.question, scope: record.scope, onStep },
      { chat, tenant, maxTokens: limits.maxTokens, maxSteps: limits.maxSteps, shouldStop: control.shouldStop }
    );
    return { answer: out.answer, tokens: out.tokens, derived: out.derived, allowed: out.allowed };
  };
}
