/**
 * POST /api/v1/invites/accept
 *
 * Validates an invite token and either:
 *  a) Adds an existing user as a member, creates session → redirect to dashboard
 *  b) For new users: returns 202 with `requiresSignup: true` so the UI can collect name+password,
 *     then a second POST with credentials creates account + session in one shot.
 *
 * No onboarding shown — invited users land directly on the workspace dashboard.
 *
 * GET /api/v1/invites/accept?token=...
 *  → Returns invite preview (workspace name, role, inviter) before the user commits.
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
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAuditLog } from "@/lib/audit";

const AcceptInviteSchema = z.object({
  token: z.string().min(64).max(68),
  // Only required for new users who need to create an account
  name: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(8).max(128).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "127.0.0.1";

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

    // ── 1. Look up and validate invite ──────────────────────────────────────
    const [invite] = await db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.token, token),
          eq(workspaceInvites.status, "pending"),
          gt(workspaceInvites.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!invite) {
      throw new AppError(
        410,
        "INVITE_INVALID",
        "This invitation link is invalid or has expired. Please ask for a new one."
      );
    }

    // ── 2. Fetch workspace ───────────────────────────────────────────────────
    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1);

    if (!workspace) {
      throw new AppError(404, "WORKSPACE_NOT_FOUND", "The workspace no longer exists.");
    }

    // ── 3. Find or create user ───────────────────────────────────────────────
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, invite.email))
      .limit(1);

    let userId: string;
    let userEmail: string;
    let isNewUser = false;

    if (existingUser) {
      userId = existingUser.id;
      userEmail = existingUser.email;
    } else {
      // New user — need name + password to create account
      if (!name || !password) {
        return NextResponse.json(
          {
            requiresSignup: true,
            email: invite.email,
            workspaceName: workspace.name,
            role: invite.role,
          },
          { status: 202 }
        );
      }

      const passwordHash = await hashPassword(password);
      const insertedUsers = await db
        .insert(users)
        .values({
          id: randomUUID(),
          email: invite.email,
          name: name.trim(),
          passwordHash,
          // Accepting an invite proves email ownership
          emailVerified: true,
        })
        .returning();

      const newUser = insertedUsers[0];
      if (!newUser) {
        throw new AppError(500, "USER_CREATE_FAILED", "Failed to create user account. Please try again.");
      }

      userId = newUser.id;
      userEmail = newUser.email;
      isNewUser = true;
    }

    // ── 4. Add to workspace (idempotent) ──────────────────────────────────────
    const [alreadyMember] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, userId)
        )
      )
      .limit(1);

    if (!alreadyMember) {
      await db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId,
        role: invite.role,
      });
    }

    // ── 5. Mark invite as accepted ────────────────────────────────────────────
    await db
      .update(workspaceInvites)
      .set({ status: "accepted" })
      .where(eq(workspaceInvites.id, invite.id));

    // Audit trail
    await recordAuditLog({
      workspaceId: workspace.id,
      actorId: userId,
      action: "invite.accepted",
      targetType: "workspace_invite",
      targetId: invite.id,
      metadata: { email: userEmail, role: invite.role, isNewUser },
      ipAddress: ip,
    });

    // ── 6. Create authenticated session ───────────────────────────────────────
    const ua = request.headers.get("user-agent") ?? undefined;

    const { token: sessionToken } = await createRegisteredSession({
      userId,
      email: userEmail,
      rememberMe: true,
      userAgent: ua,
      ipAddress: ip,
    });

    const response = NextResponse.json({
      success: true,
      isNewUser,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: invite.role,
    });

    response.cookies.set(
      SESSION_COOKIE,
      sessionToken,
      sessionCookieOptions(SESSION_SHORT_TTL_SECONDS * 30) // 30-day session
    );

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
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "127.0.0.1";

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
          eq(workspaceInvites.token, token),
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
