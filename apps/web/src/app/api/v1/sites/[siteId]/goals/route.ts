import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, goals, eq, desc } from "@trackme/db";
import { requireSiteAccess } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/http";

const CreateGoalSchema = z.object({
  name: z.string().trim().min(2).max(64),
  type: z.enum(["pageview_rule", "custom_event"]),
  pathPattern: z.string().trim().optional(),
  eventName: z.string().trim().optional(),
  targetValue: z.number().nonnegative().optional(),
}).refine(
  (data) => {
    if (data.type === "pageview_rule") {
      return Boolean(data.pathPattern && data.pathPattern.length > 0);
    }
    if (data.type === "custom_event") {
      return Boolean(data.eventName && data.eventName.length > 0);
    }
    return false;
  },
  {
    message: "Pageview rules require a path pattern, and custom event rules require an event name",
  }
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    await requireSiteAccess(request, siteId);

    const siteGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.siteId, siteId))
      .orderBy(desc(goals.createdAt));

    return NextResponse.json({ goals: siteGoals });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "sites:update");

    const parsed = CreateGoalSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid goal payload");
    }

    const createdRows = await db
      .insert(goals)
      .values({
        workspaceId: site.workspaceId,
        siteId: site.id,
        name: parsed.data.name,
        type: parsed.data.type,
        pathPattern: parsed.data.pathPattern ?? null,
        eventName: parsed.data.eventName ?? null,
        targetValue: parsed.data.targetValue ? String(parsed.data.targetValue) : null,
        enabled: true,
      })
      .returning();

    const created = createdRows[0];
    if (!created) {
      throw new AppError(500, "GOAL_CREATE_FAILED", "Failed to create conversion goal");
    }

    await recordAuditLog({
      workspaceId: site.workspaceId,
      actorId: ctx.userId,
      action: "goal:create",
      targetType: "goal",
      targetId: created.id,
      metadata: {
        name: created.name,
        type: created.type,
        pathPattern: created.pathPattern,
        eventName: created.eventName,
      },
      ipAddress: request.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json({ goal: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
