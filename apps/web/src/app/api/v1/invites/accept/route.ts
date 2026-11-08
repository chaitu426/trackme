/**
 * POST /api/v1/invites/accept
 *
 * The invite token is only ever delivered by email (see lib/invite-token.ts), so holding it proves control of
 * the invited mailbox, which is enough to CREATE an account for that address but never enough to act as an
 * account that already exists. Therefore:
 *  a) The invited address already has an account: the caller must already be signed in as that account. If not,
 *     the answer is 401 `requiresLogin`; a session is never minted from a token for an existing user.
 *  b) No account yet: 202 `requiresSignup`, then a second POST with a name and password creates the account
 *     (the email is verified by the token) and signs it in.
 * The invite is claimed atomically, so it can be used once.
 *
 * GET /api/v1/invites/accept?token=...
 *  -> Returns invite preview (workspace name, role, inviter) before the user commits.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import {
  db,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  users,
  eq,
  and,
  gt,
} from "@trackme/db";
import { jsonError } from "@/lib/http";
import {
  createRegisteredSession,
  SESSION_SHORT_TTL_SECONDS,
} from "@/lib/session-store";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { hashPassword } from "@/lib/password";
import { assertAcceptablePassword } from "@/lib/password-policy";
import { hashInviteToken } from "@/lib/invite-token";
import { requireApiUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";

const AcceptInviteSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, "Invalid invitation token."),
  // Only required for new users who need to create an account
  name: z.string().trim().min(1).max(80).optional(),
  password: z.string().max(128).optional(),
});

/** The signed-in user's id, or null when nobody is signed in. */
async function signedInUserId(request: NextRequest): Promise<string | null> {
  try {
    return (await requireApiUser(request)).id;
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return null;
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    await checkRateLimit(
      `invite_accept:${ip}`,
      10,
      15 * 60,
      "Too many invite acceptance attempts. Please try again later."
    );

    const body = await request.json().catch(() => ({}));
    const parsed = AcceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid invite token is required.");
    }

    const { token, name, password } = parsed.data;

    // ── 1. Look up and validate invite (by hash; the plaintext token is never stored) ──
    const [invite] = await db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.token, hashInviteToken(token)),
          eq(workspaceInvites.status, "pending"),
          gt(workspaceInvites.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!invite) {
      throw new AppError(410, "INVITE_INVALID", "This invitation link is invalid or has expired. Please ask for a new one.");
    }

    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1);
    if (!workspace) {
      throw new AppError(404, "WORKSPACE_NOT_FOUND", "The workspace no longer exists.");
    }

    const [existingUser] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);

    // ── 2a. Existing account: only that account, already signed in, may accept ──
    if (existingUser) {
      const callerId = await signedInUserId(request);
      if (!callerId) {
        return NextResponse.json({ requiresLogin: true, email: invite.email, workspaceName: workspace.name }, { status: 401 });
      }
      if (callerId !== existingUser.id) {
        throw new AppError(403, "INVITE_WRONG_ACCOUNT", "This invitation was sent to a different account. Sign in with the invited email address.");
      }
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(workspaceInvites)
          .set({ status: "accepted" })
          .where(and(eq(workspaceInvites.id, invite.id), eq(workspaceInvites.status, "pending")))
          .returning({ id: workspaceInvites.id });
        if (claimed.length === 0) throw new AppError(410, "INVITE_INVALID", "This invitation has already been used.");
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: workspace.id, userId: existingUser.id, role: invite.role })
          .onConflictDoNothing();
      });
      await recordAuditLog({
        workspaceId: workspace.id,
        actorId: existingUser.id,
        action: "invite.accepted",
        targetType: "workspace_invite",
        targetId: invite.id,
        metadata: { email: existingUser.email, role: invite.role, isNewUser: false },
        ipAddress: ip,
      });
      return NextResponse.json({
        success: true,
        isNewUser: false,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        role: invite.role,
      });
    }

    // ── 2b. No account yet: collect credentials, then create the account ──
    if (!name || !password) {
      return NextResponse.json(
        { requiresSignup: true, email: invite.email, workspaceName: workspace.name, role: invite.role },
        { status: 202 }
      );
    }
    await assertAcceptablePassword(password, { email: invite.email, name });
    const passwordHash = await hashPassword(password);

    const newUserId = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(workspaceInvites)
        .set({ status: "accepted" })
        .where(and(eq(workspaceInvites.id, invite.id), eq(workspaceInvites.status, "pending")))
        .returning({ id: workspaceInvites.id });
      if (claimed.length === 0) throw new AppError(410, "INVITE_INVALID", "This invitation has already been used.");

      const [created] = await tx
        .insert(users)
        .values({
          id: randomUUID(),
          email: invite.email,
          name: name.trim(),
          passwordHash,
          // The token reached this mailbox only by email, which verifies the address.
          emailVerified: true,
        })
        .returning({ id: users.id });
      if (!created) throw new AppError(500, "USER_CREATE_FAILED", "Failed to create user account. Please try again.");
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: created.id, role: invite.role });
      return created.id;
    });

    await recordAuditLog({
      workspaceId: workspace.id,
      actorId: newUserId,
      action: "invite.accepted",
      targetType: "workspace_invite",
      targetId: invite.id,
      metadata: { email: invite.email, role: invite.role, isNewUser: true },
      ipAddress: ip,
    });

    const { token: sessionToken } = await createRegisteredSession({
      userId: newUserId,
      email: invite.email,
      rememberMe: true,
      userAgent: request.headers.get("user-agent") ?? undefined,
      ipAddress: ip,
    });

    const response = NextResponse.json({
      success: true,
      isNewUser: true,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: invite.role,
    });
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(SESSION_SHORT_TTL_SECONDS * 30));
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * GET /api/v1/invites/accept?token=...
 * Returns invite preview info before the user commits.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);

    await checkRateLimit(
      `invite_preview:${ip}`,
      30,
      10 * 60,
      "Too many invite preview requests. Please try again later."
    );

    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      throw new AppError(400, "MISSING_TOKEN", "Invite token is required.");
    }

    const [invite] = await db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.token, hashInviteToken(token)),
          eq(workspaceInvites.status, "pending"),
          gt(workspaceInvites.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!invite) {
      throw new AppError(
        410,
        "INVITE_INVALID",
        "This invitation is invalid or has expired."
      );
    }

    const [workspace] = await db
      .select({ name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1);

    let inviterName: string | null = null;
    if (invite.invitedBy) {
      const [inviter] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, invite.invitedBy))
        .limit(1);
      inviterName = inviter?.name ?? null;
    }

    // Check if invited email already has an account
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, invite.email))
      .limit(1);

    return NextResponse.json({
      email: invite.email,
      role: invite.role,
      workspaceName: workspace?.name ?? "a workspace",
      workspaceSlug: workspace?.slug ?? invite.workspaceId,
      inviterName,
      expiresAt: invite.expiresAt,
      requiresSignup: !existingUser,
    });
  } catch (error) {
    return jsonError(error);
  }
}
