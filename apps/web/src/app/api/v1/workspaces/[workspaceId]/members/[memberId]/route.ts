import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError, WorkspaceRoleSchema, type WorkspaceRole } from "@trackme/contracts";
import { assertPermission, canChangeRole, canRemoveMember } from "@trackme/authz";
import { db, workspaceMembers, eq, and } from "@trackme/db";
import { invalidateMembership } from "@/lib/authz-cache";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";

const UpdateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; memberId: string }> }
) {
  try {
    const { workspaceId, memberId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");

    const body = await request.json().catch(() => ({}));
    const parsed = UpdateRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid role is required.");
    }

    const newRole = parsed.data.role;

    const [target] = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)))
      .limit(1);

    if (!target) {
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found in workspace.");
    }
    const targetRole: WorkspaceRole = WorkspaceRoleSchema.parse(target.role);

    const ip = getClientIp(request);

    // ── Ownership transfer ────────────────────────────────────────────────────
    // Both writes happen in one transaction, and the demotion only matches while the caller is still the owner,
    // so the workspace ends with exactly one owner: the old and new owner are swapped, or nothing changes.
    if (newRole === "owner") {
      if (ctx.role !== "owner") {
        throw new AppError(403, "FORBIDDEN", "Only the workspace owner can transfer ownership.");
      }
      if (ctx.userId === memberId) {
        return NextResponse.json({ message: "You are already the owner." });
      }

      const promoted = await db.transaction(async (tx) => {
        const demoted = await tx
          .update(workspaceMembers)
          .set({ role: "admin" })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, ctx.userId),
              eq(workspaceMembers.role, "owner")
            )
          )
          .returning({ userId: workspaceMembers.userId });
        if (demoted.length !== 1) {
          throw new AppError(409, "OWNERSHIP_CHANGED", "Ownership could not be transferred: it changed while you were doing it, or you own this workspace through the company rather than directly. Reload and try again.");
        }

        const [next] = await tx
          .update(workspaceMembers)
          .set({ role: "owner" })
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)))
          .returning();
        if (!next) {
          throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found in workspace.");
        }
        return next;
      });

      await Promise.all([invalidateMembership(memberId, workspaceId), invalidateMembership(ctx.userId, workspaceId)]);

      await recordAuditLog({
        workspaceId,
        actorId: ctx.userId,
        action: "workspace.ownership_transferred",
        targetType: "workspace_member",
        targetId: memberId,
        metadata: { newOwnerId: memberId, previousOwnerId: ctx.userId },
        ipAddress: ip,
      });

      return NextResponse.json({ member: promoted, ownershipTransferred: true });
    }

    // ── Standard role change ──────────────────────────────────────────────────
    if (targetRole === "owner") {
      throw new AppError(
        400,
        ctx.userId === memberId ? "CANNOT_CHANGE_OWN_ROLE" : "FORBIDDEN",
        ctx.userId === memberId
          ? "The owner cannot change their own role. Transfer ownership first."
          : "The workspace owner's role cannot be changed. They can transfer ownership instead."
      );
    }
    if (!canChangeRole(ctx.role, targetRole, newRole)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Your role (${ctx.role}) cannot change a ${targetRole} to ${newRole}. Only someone above both roles can.`
      );
    }

    const [updated] = await db
      .update(workspaceMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, memberId),
          // Guards a concurrent ownership transfer: never overwrite a role that has just become owner.
          eq(workspaceMembers.role, targetRole)
        )
      )
      .returning();
    if (!updated) {
      throw new AppError(409, "MEMBER_CHANGED", "This member's role changed while you were editing it. Reload and try again.");
    }

    await invalidateMembership(memberId, workspaceId);

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId,
      action: "member.role_updated",
      targetType: "workspace_member",
      targetId: memberId,
      metadata: { previousRole: targetRole, newRole },
      ipAddress: ip,
    });

    return NextResponse.json({ member: updated });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; memberId: string }> }
) {
  try {
    const { workspaceId, memberId } = await props.params;
    // Anyone in the workspace may leave it; removing somebody else needs `workspace:members` and a higher rank.
    const ctx = await authenticateRequest(request, workspaceId, "analytics:read");

    const isSelf = ctx.userId === memberId;
    if (!isSelf) {
      assertPermission(ctx, "workspace:members");
    }

    const [target] = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)))
      .limit(1);

    if (!target) {
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
    }
    const targetRole: WorkspaceRole = WorkspaceRoleSchema.parse(target.role);

    if (targetRole === "owner") {
      throw new AppError(400, "OWNER_CANNOT_LEAVE", "The owner cannot leave the workspace. Transfer ownership to another member first.");
    }
    if (!isSelf && !canRemoveMember(ctx.role, targetRole)) {
      throw new AppError(403, "FORBIDDEN", `Your role (${ctx.role}) cannot remove a ${targetRole}. Only someone above them can.`);
    }

    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, memberId),
          // Never delete a row that has just become the owner.
          eq(workspaceMembers.role, targetRole)
        )
      );

    await invalidateMembership(memberId, workspaceId);

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId,
      action: isSelf ? "member.left" : "member.removed",
      targetType: "workspace_member",
      targetId: memberId,
      metadata: { role: targetRole, isSelf },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ success: true, removedId: memberId, isSelf });
  } catch (error) {
    return jsonError(error);
  }
}
