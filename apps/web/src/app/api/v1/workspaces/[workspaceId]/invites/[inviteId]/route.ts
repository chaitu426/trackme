import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, workspaceInvites, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; inviteId: string }> }
) {
  try {
    const { workspaceId, inviteId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");

    // Revoke, never delete: the row stays as the record of who was invited, and the token stops working.
    const deleted = await db
      .update(workspaceInvites)
      .set({ status: "revoked" })
      .where(
        and(
          eq(workspaceInvites.id, inviteId),
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.status, "pending")
        )
      )
      .returning({ id: workspaceInvites.id, email: workspaceInvites.email });

    if (!deleted[0]) {
      throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found.");
    }

    const ip = getClientIp(request);

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
