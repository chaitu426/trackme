import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, teams, teamMembers, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { bumpAccessVersion } from "@/lib/access";
import { requireTeamInWorkspace, requireWorkspaceMemberRow } from "@/lib/teams";

type Props = { params: Promise<{ workspaceId: string; teamId: string; userId: string }> };

const Body = z.object({ role: z.enum(["lead", "member"]).default("member") });

/** PUT: adds a workspace member to a team (or changes their role in it). */
export async function PUT(request: NextRequest, props: Props) {
  try {
    const { workspaceId, teamId, userId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    await requireTeamInWorkspace(workspaceId, teamId);
    await requireWorkspaceMemberRow(workspaceId, userId);

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "A team role is 'lead' or 'member'.");

    await db.transaction(async (tx) => {
      if (parsed.data.role === "lead") {
        await tx.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "lead")));
        await tx.update(teams).set({ leadUserId: userId }).where(eq(teams.id, teamId));
      }
      await tx
        .insert(teamMembers)
        .values({ teamId, userId, role: parsed.data.role, addedBy: ctx.userId })
        .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: { role: parsed.data.role } });
    });

    await bumpAccessVersion(workspaceId);
    await recordAuditLog({ workspaceId, actorId: ctx.userId, action: "team.member_added", targetType: "team", targetId: teamId, metadata: { userId, role: parsed.data.role }, ipAddress: getClientIp(request) });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** DELETE: takes someone off a team. They stay in the workspace, with whatever their other teams give them. */
export async function DELETE(request: NextRequest, props: Props) {
  try {
    const { workspaceId, teamId, userId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    await requireTeamInWorkspace(workspaceId, teamId);

    await db.transaction(async (tx) => {
      const removed = await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))).returning({ userId: teamMembers.userId });
      if (removed.length === 0) throw new AppError(404, "MEMBER_NOT_FOUND", "That person is not on this team.");
      await tx.update(teams).set({ leadUserId: null }).where(and(eq(teams.id, teamId), eq(teams.leadUserId, userId)));
    });

    await bumpAccessVersion(workspaceId);
    await recordAuditLog({ workspaceId, actorId: ctx.userId, action: "team.member_removed", targetType: "team", targetId: teamId, metadata: { userId }, ipAddress: getClientIp(request) });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
