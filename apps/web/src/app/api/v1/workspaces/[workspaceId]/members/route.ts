import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { hasPermission } from "@trackme/authz";
import {
  db,
  workspaceMembers,
  workspaceInvites,
  workspaces,
  users,
  eq,
  and,
  sql,
} from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { sendInviteEmail } from "@/lib/email";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { newInviteToken } from "@/lib/invite-token";
import { checkRateLimit } from "@/lib/rate-limit";

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
    const ctx = await authenticateRequest(request, workspaceId, "read:analytics");

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

    // Pending invitations (who is being invited, with which role) are for people who manage members.
    return NextResponse.json({ members, invites: hasPermission(ctx.role, "workspace:members") ? invites : [] });
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

    // Invitations send mail from our domain to any address, so they are limited per inviter and per
    // workspace, capped while pending, and only a verified account may send them.
    await checkRateLimit(`invite_user:${ctx.userId}`, 20, 60 * 60, "Too many invitations sent. Try again later.");
    await checkRateLimit(`invite_ws:${workspaceId}`, 50, 60 * 60, "This workspace has sent too many invitations. Try again later.");
    const [pending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, "pending")));
    if ((pending?.n ?? 0) >= 100) {
      throw new AppError(429, "TOO_MANY_PENDING_INVITES", "Revoke some pending invitations before sending more.");
    }
    if (ctx.userId && !ctx.userId.startsWith("api-key:")) {
      const [inviterRow] = await db.select({ ok: users.emailVerified }).from(users).where(eq(users.id, ctx.userId)).limit(1);
      if (!inviterRow?.ok) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email address before inviting others.");
    }

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

    // Only the hash is stored; the plaintext goes into the email and nowhere else (see invite-token.ts).
    const { token, tokenHash } = newInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [created] = await db
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email,
        role,
        token: tokenHash,
        invitedBy: ctx.userId ?? null,
        status: "pending",
        expiresAt,
      })
      .returning();

    if (!created) {
      throw new AppError(500, "INVITE_CREATE_FAILED", "Failed to create invitation.");
    }

    const ip = getClientIp(request);

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
      // The token is deliberately not part of the response.
      invite: { id: created.id, email: created.email, role: created.role, status: created.status, expiresAt: created.expiresAt },
      message: `Invitation sent to ${email}.`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
