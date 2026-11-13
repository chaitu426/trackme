import { z } from "zod";
import { AppError, AccessLevelSchema, FeatureSchema, type FeatureGrant } from "@trackme/contracts";
import { db, teams, workspaceMembers, eq, and } from "@trackme/db";

export const TeamNameSchema = z.string().trim().min(2, "A team name needs at least 2 characters.").max(48, "A team name can be at most 48 characters.");

export function teamSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length >= 2 ? slug : "team";
}

/** A grant map as the screens send it: `{ errors: "view", payments: "manage" }`. Anything unknown is an error, not ignored. */
export const GrantMapSchema = z.record(z.string(), z.unknown());

export function parseGrantMap(input: unknown): FeatureGrant[] {
  const map = GrantMapSchema.safeParse(input);
  if (!map.success) throw new AppError(400, "INVALID_INPUT", "Access must be a list of features and levels.");
  const grants: FeatureGrant[] = [];
  for (const [rawFeature, rawLevel] of Object.entries(map.data)) {
    const feature = FeatureSchema.safeParse(rawFeature);
    if (!feature.success) throw new AppError(400, "INVALID_INPUT", `'${rawFeature}' is not a feature.`);
    // null means "no access": the feature simply has no row.
    if (rawLevel === null || rawLevel === "none") continue;
    const level = AccessLevelSchema.safeParse(rawLevel);
    if (!level.success) throw new AppError(400, "INVALID_INPUT", `'${String(rawLevel)}' is not an access level for ${rawFeature}.`);
    grants.push({ feature: feature.data, level: level.data });
  }
  return grants;
}

export async function requireTeamInWorkspace(workspaceId: string, teamId: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)))
    .limit(1);
  if (!team) throw new AppError(404, "TEAM_NOT_FOUND", "Team not found in this workspace.");
  return team;
}

/** Only people who belong to the workspace can join its teams. */
export async function requireWorkspaceMemberRow(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!row) throw new AppError(404, "MEMBER_NOT_FOUND", "That person is not a member of this workspace.");
  return row;
}
