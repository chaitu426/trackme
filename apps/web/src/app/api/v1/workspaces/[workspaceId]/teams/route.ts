import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, teams, teamMembers } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { assertFeature, planOfWorkspace } from "@/lib/plan";
import { bumpAccessVersion } from "@/lib/access";
import { TeamNameSchema, requireWorkspaceMemberRow, teamSlug } from "@/lib/teams";
import { listTeams, loadAccessMatrix } from "@/lib/teams-data";

const CreateTeam = z.object({
  name: TeamNameSchema,
  description: z.string().trim().max(200).optional(),
  leadUserId: z.string().uuid().optional(),
});

/** GET /api/v1/workspaces/:id/teams: every team with its people, plus whether the plan includes teams and the access mode. */
export async function GET(request: NextRequest, props: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await props.params;
    await authenticateRequest(request, workspaceId, "members:read");
    const [list, { teamsEnabled, mode }] = await Promise.all([listTeams(workspaceId), loadAccessMatrix(workspaceId)]);
    return NextResponse.json({ teamsEnabled, accessMode: mode, teams: list });
  } catch (error) {
    return jsonError(error);
  }
}

/** POST /api/v1/workspaces/:id/teams: create a team (Pro). */
export async function POST(request: NextRequest, props: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    assertFeature((await planOfWorkspace(workspaceId)).plan, "teams");

    const parsed = CreateTeam.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "A team needs a name.");
    if (parsed.data.leadUserId) await requireWorkspaceMemberRow(workspaceId, parsed.data.leadUserId);

    const base = teamSlug(parsed.data.name);
    const team = await db.transaction(async (tx) => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const [created] = await tx
          .insert(teams)
          .values({ workspaceId, name: parsed.data.name, slug, description: parsed.data.description ?? null, leadUserId: parsed.data.leadUserId ?? null })
          .onConflictDoNothing()
          .returning();
        if (created) {
          if (parsed.data.leadUserId) {
            await tx.insert(teamMembers).values({ teamId: created.id, userId: parsed.data.leadUserId, role: "lead", addedBy: ctx.userId });
          }
          return created;
        }
      }
      throw new AppError(409, "TEAM_EXISTS", "A team with that name already exists.");
    });

    await bumpAccessVersion(workspaceId);
    await recordAuditLog({ workspaceId, actorId: ctx.userId, action: "team.created", targetType: "team", targetId: team.id, metadata: { name: team.name }, ipAddress: getClientIp(request) });
    return NextResponse.json({ team: { ...team, members: [] } }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
