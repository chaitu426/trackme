import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, askRuns, and, eq, inArray } from "@trackme/db";
import { publish, type QueueRedis } from "@trackme/ask";
import { requireMetricsAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The state of one run: queued/running/done/failed, and the answer once done. This is the fallback the browser uses when the
 * SSE stream has aged out of Redis or the connection dropped before the run finished.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const rows = await db
      .select()
      .from(askRuns)
      .where(eq(askRuns.id, runId))
      .limit(1);
    const run = rows[0];
    if (!run || !run.siteId) throw new AppError(404, "NOT_FOUND", "Run not found");

    await requireMetricsAccess(request, run.workspaceId, run.siteId);

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      answer: run.status === "done" ? run.answer : null,
      error: run.status === "failed" ? run.error : null,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Stop a run. Only the person who asked may stop it. The row goes to `cancelled` (the worker checks between model calls and
 * stops spending), and a terminal event is published so any listener ends now rather than waiting for the worker.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const [run] = await db.select().from(askRuns).where(eq(askRuns.id, runId)).limit(1);
    if (!run || !run.siteId) throw new AppError(404, "NOT_FOUND", "Run not found");

    const ctx = await requireMetricsAccess(request, run.workspaceId, run.siteId);
    if (run.createdBy && run.createdBy !== ctx.userId) throw new AppError(403, "FORBIDDEN", "Only the person who asked can stop this run.");

    const stopped = await db
      .update(askRuns)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(askRuns.id, runId), inArray(askRuns.status, ["queued", "running"])))
      .returning({ id: askRuns.id });
    if (stopped.length > 0) {
      await publish(getRedis("state") as unknown as QueueRedis, runId, { type: "error", message: "Stopped." }).catch(() => undefined);
    }
    return NextResponse.json({ runId, status: stopped.length > 0 ? "cancelled" : run.status });
  } catch (error) {
    return jsonError(error);
  }
}
