import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, askRuns, eq } from "@trackme/db";
import { requireMetricsAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

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
