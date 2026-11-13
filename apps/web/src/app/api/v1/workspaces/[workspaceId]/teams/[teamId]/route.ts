import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, teams, teamMembers, eq, and } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { bumpAccessVersion } from "@/lib/access";
import { TeamNameSchema, requireTeamInWorkspace, requireWorkspaceMemberRow } from "@/lib/teams";

const UpdateTeam = z.object({
  name: TeamNameSchema.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  /** null clears the lead. */
  leadUserId: z.string().uuid().nullable().optional(),
});

type Props = { params: Promise<{ workspaceId: string; teamId: string }> };

/** PATCH: rename, describe, or change the lead of a team. The lead is always a member of the team. */
export async function PATCH(request: NextRequest, props: Props) {
  try {
    const { workspaceId, teamId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    const team = await requireTeamInWorkspace(workspaceId, teamId);

    const parsed = UpdateTeam.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid team update.");
    const { name, description, leadUserId } = parsed.data;
    if (leadUserId) await requireWorkspaceMemberRow(workspaceId, leadUserId);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(teams)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(leadUserId !== undefined ? { leadUserId } : {}),
        })
        .where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)))
        .returning();
      if (leadUserId !== undefined) {
        // One lead at a time: the previous one stays on the team as an ordinary member.
        await tx.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "lead")));
        if (leadUserId) {
          await tx
            .insert(teamMembers)
            .values({ teamId, userId: leadUserId, role: "lead", addedBy: ctx.userId })
            .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: { role: "lead" } });
        }
      }
      return row;
    });

    await bumpAccessVersion(workspaceId);
    await recordAuditLog({ workspaceId, actorId: ctx.userId, action: "team.updated", targetType: "team", targetId: teamId, metadata: { from: team.name, ...parsed.data }, ipAddress: getClientIp(request) });
    return NextResponse.json({ team: updated });
  } catch (error) {
    return jsonError(error);
  }
}

/** DELETE: removes the team and everything it was granted. People stay in the workspace. */
export async function DELETE(request: NextRequest, props: Props) {
  try {
    const { workspaceId, teamId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    const team = await requireTeamInWorkspace(workspaceId, teamId);

    await db.delete(teams).where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)));

    await bumpAccessVersion(workspaceId);
    await recordAuditLog({ workspaceId, actorId: ctx.userId, action: "team.deleted", targetType: "team", targetId: teamId, metadata: { name: team.name }, ipAddress: getClientIp(request) });
    return NextResponse.json({ success: true, deletedId: teamId });
  } catch (error) {
    return jsonError(error);
  }
}
