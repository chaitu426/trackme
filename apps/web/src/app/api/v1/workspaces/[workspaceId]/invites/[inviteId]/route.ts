import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, workspaceInvites, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; inviteId: string }> }
) {
  try {
    const { workspaceId, inviteId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "admin:workspace");

    const deleted = await db
      .delete(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.id, inviteId),
          eq(workspaceInvites.workspaceId, workspaceId)
        )
      )
      .returning({ id: workspaceInvites.id, email: workspaceInvites.email });

    if (!deleted[0]) {
      throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found.");
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId ?? null,
      action: "invite.revoked",
      targetType: "workspace_invite",
      targetId: inviteId,
      metadata: { email: deleted[0].email },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, deletedId: inviteId });
  } catch (error) {
    return jsonError(error);
  }
}
