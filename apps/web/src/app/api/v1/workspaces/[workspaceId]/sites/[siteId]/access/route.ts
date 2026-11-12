import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, sites, teams, siteTeamFeatures, siteUserFeatures, eq, and, inArray } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { assertFeature, planOfWorkspace } from "@/lib/plan";
import { bumpAccessVersion } from "@/lib/access";
import { parseGrantMap, requireWorkspaceMemberRow } from "@/lib/teams";

const Body = z.object({
  /** teamId -> { feature: "view" | "manage" | "none" }. Only the teams listed are changed. */
  teams: z.record(z.string().uuid(), z.unknown()).optional(),
  /** userId -> the same, for people granted access directly. */
  users: z.record(z.string().uuid(), z.unknown()).optional(),
});

/**
 * PUT /api/v1/workspaces/:id/sites/:siteId/access
 *
 * Sets what teams (and, optionally, individual people) may use on one site. Each team or person listed has their grants on
 * this site replaced by exactly what is sent; ones not listed are left alone. Pro only.
 */
export async function PUT(request: NextRequest, props: { params: Promise<{ workspaceId: string; siteId: string }> }) {
  try {
    const { workspaceId, siteId } = await props.params;
    const ctx = await authenticateRequest(request, workspaceId, "workspace:members");
    assertFeature((await planOfWorkspace(workspaceId)).plan, "teams");

    const [site] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId))).limit(1);
    if (!site) throw new AppError(404, "SITE_NOT_FOUND", "Site not found in this workspace.");

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "Send grants as { teams: { <teamId>: { <feature>: <level> } } }.");

    const teamEntries = Object.entries(parsed.data.teams ?? {}).map(([id, map]) => [id, parseGrantMap(map)] as const);
    const userEntries = Object.entries(parsed.data.users ?? {}).map(([id, map]) => [id, parseGrantMap(map)] as const);
    if (teamEntries.length === 0 && userEntries.length === 0) throw new AppError(400, "INVALID_INPUT", "Nothing to change.");

    // Every team and person must belong to this workspace: a grant can never point at someone else's.
    if (teamEntries.length) {
      const found = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.workspaceId, workspaceId), inArray(teams.id, teamEntries.map(([id]) => id))));
      if (found.length !== teamEntries.length) throw new AppError(404, "TEAM_NOT_FOUND", "One of those teams is not in this workspace.");
    }
    for (const [userId] of userEntries) await requireWorkspaceMemberRow(workspaceId, userId);

    await db.transaction(async (tx) => {
      for (const [teamId, grants] of teamEntries) {
        await tx.delete(siteTeamFeatures).where(and(eq(siteTeamFeatures.siteId, siteId), eq(siteTeamFeatures.teamId, teamId)));
        if (grants.length) await tx.insert(siteTeamFeatures).values(grants.map((g) => ({ siteId, teamId, feature: g.feature, level: g.level })));
      }
      for (const [userId, grants] of userEntries) {
        await tx.delete(siteUserFeatures).where(and(eq(siteUserFeatures.siteId, siteId), eq(siteUserFeatures.userId, userId)));
        if (grants.length) await tx.insert(siteUserFeatures).values(grants.map((g) => ({ siteId, userId, feature: g.feature, level: g.level })));
      }
    });

    await bumpAccessVersion(workspaceId);
    await recordAuditLog({
      workspaceId,
      actorId: ctx.userId,
      action: "site_access.updated",
      targetType: "site",
      targetId: siteId,
      metadata: { teams: teamEntries.map(([id, g]) => ({ id, grants: g })), users: userEntries.map(([id, g]) => ({ id, grants: g })) },
      ipAddress: getClientIp(request),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
