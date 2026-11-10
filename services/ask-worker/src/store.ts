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
        .where(eq(askRuns.id, runId));
    },
    async markFailed(runId: string, error: string): Promise<void> {
      await db
        .update(askRuns)
        .set({ status: "failed", error: error.slice(0, 2000), finishedAt: sql`now()` })
        .where(eq(askRuns.id, runId));
    },
  };
}

/** Runs stuck in queued/running past the timeout are reset to queued so the stream can deliver them again. */
export async function requeueStale(timeoutMs: number): Promise<number> {
  // The cutoff is inlined as a literal: a bound `Date` inside a raw `sql` comparison reaches postgres.js unencoded.
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const rows = await db
    .update(askRuns)
    .set({ status: "queued", heartbeatAt: null })
    .where(
      sql`${askRuns.status} in ('queued', 'running') and coalesce(${askRuns.heartbeatAt}, ${askRuns.createdAt}) < ${cutoff}::timestamptz`
    )
    .returning({ id: askRuns.id });
  return rows.length;
}
