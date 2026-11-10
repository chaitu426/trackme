import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, askRuns, sites, and, eq, inArray } from "@trackme/db";
import { env } from "@trackme/config";
import { RunInputSchema, clampScope, enqueue, limiterStatus, streamKey, type QueueRedis } from "@trackme/ask";
import { requireApiUser } from "@/lib/auth";
import { requireMetricsAccess, requireWorkspaceBySlug } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

/**
 * Queue an Ask run. The LLM and ClickHouse work happens in the ask worker; this route authorizes, clamps the scope, refuses
 * early when the deployment is over its budget, writes the run row and enqueues it, then returns the run id. The browser
 * follows the run over SSE (`/api/v1/ask/runs/:id/events`).
 */
async function handlePost(request: NextRequest) {
  try {
    if (!env.ASK_ENABLED) {
      throw new AppError(503, "ASK_DISABLED", "Ask is not enabled on this deployment.");
    }

    const body: unknown = await request.json();
    const parsed = RunInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid Ask payload", details: parsed.error.errors }, { status: 400 });
    }
    const scope = clampScope(parsed.data.scope);

    // The scope names a workspace and its sites; membership comes before anything is read for it.
    const user = await requireApiUser(request);
    const workspace = await requireWorkspaceBySlug(user.id, scope.workspaceSlug);
    if (scope.siteDomains.length === 0) {
      throw new AppError(400, "ASK_NO_SITE", "No site in scope. Open a site's dashboard and ask from there.");
    }
    const siteRows = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.workspaceId, workspace.id), inArray(sites.domain, scope.siteDomains)))
      .limit(1);
    const site = siteRows[0];
    if (!site) throw new AppError(400, "ASK_NO_SITE", "The site in scope is not part of this workspace.");

    const ctx = await requireMetricsAccess(request, workspace.id, site.id);

    const redis = getRedis("state");
    const status = await limiterStatus(redis as unknown as { eval: never; get: never }, ctx.workspaceId, {
      capacity: env.ASK_LLM_RPM,
      workspaceLimit: env.ASK_WORKSPACE_CONCURRENCY,
    });
    if (!status.ok) {
      const message =
        status.reason === "workspace"
          ? "You already have answers in progress. Wait for one to finish."
          : "Ask is at its shared limit right now. Retry in a few seconds.";
      return NextResponse.json(new AppError(429, "ASK_BUSY", message).toProblemDetails(), {
        status: 429,
        headers: { "Retry-After": status.reason === "workspace" ? "10" : "20" },
      });
    }

    const [run] = await db
      .insert(askRuns)
      .values({
        workspaceId: ctx.workspaceId,
        siteId: site.id,
        createdBy: ctx.userId.startsWith("api-key:") ? null : ctx.userId,
        question: parsed.data.question,
        scope,
        status: "queued",
        model: env.ASK_MODEL,
      })
      .returning({ id: askRuns.id });
    if (!run) throw new AppError(500, "ASK_RUN_NOT_CREATED", "Could not record the run.");

    // Clear any stream left from a previous run with the same id (ids are fresh, so this is belt-and-braces).
    await redis.del(streamKey(run.id));
    await enqueue(redis as unknown as QueueRedis, run.id);

    void recordAuditLog({
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId.startsWith("api-key:") ? null : ctx.userId,
      action: "ask:run",
      targetType: "ask_run",
      targetId: run.id,
      metadata: { question: parsed.data.question.slice(0, 200), sources: scope.sources, range: scope.range },
      ipAddress: request.headers.get("x-forwarded-for") ?? null,
    });

    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = timedRoute("ask_runs", handlePost);
