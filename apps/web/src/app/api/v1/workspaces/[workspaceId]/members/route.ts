import { randomBytes } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import {
  db,
  workspaceMembers,
  workspaceInvites,
  workspaces,
  users,
  eq,
  and,
} from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { sendInviteEmail } from "@/lib/email";
import { recordAuditLog } from "@/lib/audit";

const InviteMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(request, workspaceId, "read:analytics");

    const members = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    const invites = await db
      .select({
        id: workspaceInvites.id,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        status: workspaceInvites.status,
        token: workspaceInvites.token,
        expiresAt: workspaceInvites.expiresAt,
        createdAt: workspaceInvites.createdAt,
      })
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.status, "pending")
        )
      );

    return NextResponse.json({ members, invites });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "admin:workspace");

    const body = await request.json().catch(() => ({}));
    const parsed = InviteMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid email address is required.");
    }

    const email = parsed.data.email.toLowerCase();
    const role = parsed.data.role;

    // Check if user is already a member
    const existingMember = await db
      .select({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, email)))
      .limit(1);

    if (existingMember[0]) {
      throw new AppError(409, "MEMBER_EXISTS", "This user is already a member of this workspace.");
    }

    // Revoke any prior pending invite — allows re-sending fresh invites
    await db
      .update(workspaceInvites)
      .set({ status: "revoked" })
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.email, email),
          eq(workspaceInvites.status, "pending")
        )
      );

    // 32-byte hex token = 256-bit entropy, safe for URL use
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [created] = await db
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email,
        role,
        token,
        invitedBy: ctx.userId ?? null,
        status: "pending",
        expiresAt,
      })
      .returning();

    if (!created) {
      throw new AppError(500, "INVITE_CREATE_FAILED", "Failed to create invitation.");
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId ?? null,
      action: "invite.created",
      targetType: "workspace_invite",
      targetId: created.id,
      metadata: { email, role },
      ipAddress: ip,
    });

    // Fetch workspace + inviter for the email (non-critical — don't fail the request)
    const sendEmail = async () => {
      const [workspaceRow] = await db
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      let inviterName = "A teammate";
      if (ctx.userId) {
        const [inviter] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.userId))
          .limit(1);
        if (inviter?.name) inviterName = inviter.name;
      }

      await sendInviteEmail({
        to: email,
        inviterName,
        workspaceName: workspaceRow?.name ?? "a workspace",
        workspaceSlug: workspaceRow?.slug ?? workspaceId,
        role,
        token,
        expiresAt,
      });
    };

    sendEmail().catch((err) =>
      console.error("[Invite] Email dispatch failed:", err)
    );

    return NextResponse.json({
      invite: created,
      message: `Invitation sent to ${email}.`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
