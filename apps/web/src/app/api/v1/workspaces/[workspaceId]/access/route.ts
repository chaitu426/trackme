import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, AccessModeSchema } from "@trackme/contracts";
import { db, workspaces, eq } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { assertFeature, planOfWorkspace } from "@/lib/plan";
import { bumpAccessVersion } from "@/lib/access";
import { loadAccessMatrix } from "@/lib/teams-data";

type Props = { params: Promise<{ workspaceId: string }> };

/**
 * GET /api/v1/workspaces/:id/access
 *
 * The access matrix: the mode, whether the plan includes teams, and for every site the grants each team and person holds.
 */
export async function GET(request: NextRequest, props: Props) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(request, workspaceId, "workspace:members");
    return NextResponse.json(await loadAccessMatrix(workspaceId));
  } catch (error) {
    return jsonError(error);
  }
}

const SetMode = z.object({ mode: AccessModeSchema });

/**
 * PUT /api/v1/workspaces/:id/access  { mode }
 *
 * open: members and viewers see what their role allows, as before. restricted: they see only what their teams and personal
 * grants give them, per site. Restricting is a Pro feature; owners and admins are never restricted.
 */
export async function PUT(request: NextRequest, props: Props) {
  try {
    const { workspaceId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    const parsed = SetMode.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "The mode is 'open' or 'restricted'.");

    if (parsed.data.mode === "restricted") assertFeature((await planOfWorkspace(workspaceId)).plan, "teams");

    await db.update(workspaces).set({ accessMode: parsed.data.mode, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    await bumpAccessVersion(workspaceId);
    await recordAuditLog({ workspaceId, actorId: ctx.userId, action: "access.mode_changed", targetType: "workspace", targetId: workspaceId, metadata: { mode: parsed.data.mode }, ipAddress: getClientIp(request) });
    return NextResponse.json({ mode: parsed.data.mode });
  } catch (error) {
    return jsonError(error);
  }
}
