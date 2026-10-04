import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, goals, eq, and } from "@trackme/db";
import { requireSiteAccess } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

const PatchGoalSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  pathPattern: z.string().trim().optional(),
  eventName: z.string().trim().optional(),
  targetValue: z.number().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; goalId: string }> }
) {
  try {
    const { siteId, goalId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");

    const body = await request.json().catch(() => ({}));
    const parsed = PatchGoalSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "Invalid goal update parameters.");
    }

    const updates: Partial<{
      name: string;
      enabled: boolean;
      pathPattern: string | null;
      eventName: string | null;
      targetValue: string | null;
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
    if (parsed.data.pathPattern !== undefined) updates.pathPattern = parsed.data.pathPattern;
    if (parsed.data.eventName !== undefined) updates.eventName = parsed.data.eventName;
    if (parsed.data.targetValue !== undefined) {
      updates.targetValue = parsed.data.targetValue !== null ? String(parsed.data.targetValue) : null;
    }

    const updatedRows = await db
      .update(goals)
      .set(updates)
      .where(and(eq(goals.id, goalId), eq(goals.siteId, siteId)))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      throw new AppError(404, "NOT_FOUND", "Goal not found on this site");
    }

    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "goal:update",
      targetType: "goal",
      targetId: goalId,
      metadata: { updates },
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({ goal: updated });
  } catch (error) {
    return jsonError(error);
  }
}

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
