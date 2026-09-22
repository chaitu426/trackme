import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, goals, eq, and } from "@trackme/db";
import { requireSiteAccess } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; goalId: string }> }
) {
  try {
    const { siteId, goalId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");

    const existingRows = await db
      .select({
        id: goals.id,
        name: goals.name,
      })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.siteId, siteId)))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Goal not found on this site");
    }

    await db
      .delete(goals)
      .where(and(eq(goals.id, goalId), eq(goals.siteId, siteId)));

    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "goal:delete",
      targetType: "goal",
      targetId: goalId,
      metadata: { name: existing.name },
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({ success: true, deletedId: goalId });
  } catch (error) {
    return jsonError(error);
  }
}
