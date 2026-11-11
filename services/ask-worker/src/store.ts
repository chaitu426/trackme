import { and, eq, inArray, sql } from "@trackme/db";
import { askRuns, db } from "@trackme/db";
import type { Answer, AskScope } from "@trackme/ask";
import type { RunRecord, RunStore } from "./run.js";

/** The Postgres side of a run. The worker owns status transitions; the web app only inserts and reads. */
export function createRunStore(): RunStore {
  return {
    async load(runId: string): Promise<RunRecord | null> {
      const [row] = await db
        .select()
        .from(askRuns)
        .where(eq(askRuns.id, runId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        siteId: row.siteId,
        question: row.question,
        scope: row.scope as AskScope,
        status: row.status,
      };
    },
    async markRunning(runId: string): Promise<void> {
      await db
        .update(askRuns)
        .set({ status: "running", heartbeatAt: sql`now()` })
        .where(and(eq(askRuns.id, runId), inArray(askRuns.status, ["queued", "running"])));
    },
    async heartbeat(runId: string): Promise<void> {
      await db.update(askRuns).set({ heartbeatAt: sql`now()` }).where(eq(askRuns.id, runId));
    },
    async markDone(runId: string, answer: Answer, meta: { model: string; tokens: number }): Promise<void> {
      await db
        .update(askRuns)
        .set({ status: "done", answer, model: meta.model, tokens: meta.tokens, finishedAt: sql`now()` })
        // A run the person stopped stays stopped, even if the model call that was in flight comes back afterwards.
        .where(and(eq(askRuns.id, runId), inArray(askRuns.status, ["queued", "running"])));
    },
    async markFailed(runId: string, error: string): Promise<void> {
      await db
        .update(askRuns)
        .set({ status: "failed", error: error.slice(0, 2000), finishedAt: sql`now()` })
        .where(and(eq(askRuns.id, runId), inArray(askRuns.status, ["queued", "running"])));
    },
    async isCancelled(runId: string): Promise<boolean> {
      const [row] = await db.select({ status: askRuns.status }).from(askRuns).where(eq(askRuns.id, runId)).limit(1);
      return row?.status === "cancelled";
    },
    async markCancelled(runId: string): Promise<void> {
      await db
        .update(askRuns)
        .set({ status: "cancelled", finishedAt: sql`now()` })
        .where(and(eq(askRuns.id, runId), inArray(askRuns.status, ["queued", "running", "cancelled"])));
    },
  };
}

/** A run older than this is abandoned rather than retried again: the person has long since stopped waiting. */
const GIVE_UP_AFTER_MS = 10 * 60_000;

/**
 * Handles runs whose worker went quiet (heartbeat, or creation time if never picked up, older than `timeoutMs`).
 * Runs older than ten minutes are failed with a clear message; younger ones are reset to queued and their ids returned so
 * the caller can put them back on the stream (resetting the row alone would leave them waiting for a delivery that never comes).
 */
export async function requeueStale(timeoutMs: number): Promise<string[]> {
  // The cutoff is inlined as a literal: a bound `Date` inside a raw `sql` comparison reaches postgres.js unencoded.
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const giveUp = new Date(Date.now() - GIVE_UP_AFTER_MS).toISOString();
  await db
    .update(askRuns)
    .set({ status: "failed", error: "Ask took too long and was stopped. Try again.", finishedAt: sql`now()` })
    .where(sql`${askRuns.status} in ('queued', 'running') and ${askRuns.createdAt} < ${giveUp}::timestamptz`);
  const rows = await db
    .update(askRuns)
    .set({ status: "queued", heartbeatAt: null })
    .where(
      sql`${askRuns.status} in ('queued', 'running') and coalesce(${askRuns.heartbeatAt}, ${askRuns.createdAt}) < ${cutoff}::timestamptz`
    )
    .returning({ id: askRuns.id });
  return rows.map((r) => r.id);
}
