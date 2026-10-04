import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, workspaceMembers, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";

const UpdateRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string; memberId: string }> }
) {
  try {
    const { workspaceId, memberId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "admin:workspace");

    const body = await request.json().catch(() => ({}));
    const parsed = UpdateRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid role is required.");
    }

    const newRole = parsed.data.role;

    // Check if target member exists
    const [target] = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, memberId)
        )
      )
      .limit(1);

    if (!target) {
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found in workspace.");
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    // ── Ownership Transfer Flow ──────────────────────────────────────────────
    if (newRole === "owner") {
      if (ctx.role !== "owner") {
        throw new AppError(403, "FORBIDDEN", "Only the workspace owner can transfer ownership.");
      }
      if (ctx.userId === memberId) {
        return NextResponse.json({ message: "You are already the owner." });
      }

      // Demote current owner to admin
      if (ctx.userId) {
        await db
          .update(workspaceMembers)
          .set({ role: "admin" })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, ctx.userId)
            )
          );
      }

      // Promote target member to owner
      const [promoted] = await db
        .update(workspaceMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, memberId)
          )
        )
        .returning();

      await recordAuditLog({
        workspaceId,
        actorId: ctx.userId ?? null,
        action: "workspace.ownership_transferred",
        targetType: "workspace_member",
        targetId: memberId,
        metadata: { newOwnerId: memberId, previousOwnerId: ctx.userId },
        ipAddress: ip,
      });

      return NextResponse.json({ member: promoted, ownershipTransferred: true });
    }

    // ── Standard Role Change ──────────────────────────────────────────────────
    // Prevent changing own role if owner
    if (ctx.userId === memberId && ctx.role === "owner") {
      throw new AppError(400, "CANNOT_CHANGE_OWN_ROLE", "Owner cannot change their own role. Transfer ownership first.");
    }

    // Prevent non-owners from modifying an owner's role
    if (target.role === "owner" && ctx.role !== "owner") {
      throw new AppError(403, "FORBIDDEN", "Cannot modify the workspace owner's role.");
    }

    const updated = await db
      .update(workspaceMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, memberId)
        )
      )
      .returning();

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId ?? null,
      action: "member.role_updated",
      targetType: "workspace_member",
      targetId: memberId,
      metadata: { previousRole: target.role, newRole },
      ipAddress: ip,
    });

    return NextResponse.json({ member: updated[0] });
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
    // Allow any workspace member with read:analytics to self-leave; require admin:workspace to remove others
    const ctx = await authenticateRequest(request, workspaceId, "read:analytics");

    const isSelf = ctx.userId === memberId;
    if (!isSelf && ctx.role !== "admin" && ctx.role !== "owner") {
      throw new AppError(403, "FORBIDDEN", "Only admins or owners can remove other members.");
    }

    // Target check
    const [target] = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, memberId)
        )
      )
      .limit(1);

    if (!target) {
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
    }

    if (target.role === "owner") {
      throw new AppError(400, "OWNER_CANNOT_LEAVE", "The owner cannot leave the workspace. Transfer ownership to another member first.");
    }

    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, memberId)
        )
      );

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId ?? null,
      action: isSelf ? "member.left" : "member.removed",
      targetType: "workspace_member",
      targetId: memberId,
      metadata: { role: target.role, isSelf },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, removedId: memberId, isSelf });
  } catch (error) {
    return jsonError(error);
  }
}
