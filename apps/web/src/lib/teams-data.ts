import { limitsFor, FEATURES, type AccessMode } from "@trackme/contracts";
import { db, teams, teamMembers, users, workspaces, workspaceMembers, sites, siteTeamFeatures, siteUserFeatures, eq, inArray } from "@trackme/db";
import { planOfWorkspace } from "@/lib/plan";

export interface TeamView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  leadUserId: string | null;
  members: { id: string; name: string | null; email: string; role: string }[];
}

export interface SiteAccessView {
  id: string;
  domain: string;
  displayName: string;
  /** teamId -> feature -> level */
  teams: Record<string, Record<string, string>>;
  /** userId -> feature -> level */
  users: Record<string, Record<string, string>>;
}

export async function listTeams(workspaceId: string): Promise<TeamView[]> {
  const [rows, memberRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.workspaceId, workspaceId)).orderBy(teams.name),
    db
      .select({ teamId: teamMembers.teamId, id: users.id, name: users.name, email: users.email, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teams.workspaceId, workspaceId)),
  ]);
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    leadUserId: t.leadUserId,
    members: memberRows.filter((m) => m.teamId === t.id).map(({ teamId: _teamId, ...m }) => m),
  }));
}

export async function loadAccessMatrix(workspaceId: string) {
  const [[ws], { plan }, siteRows] = await Promise.all([
    db.select({ mode: workspaces.accessMode }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1),
    planOfWorkspace(workspaceId),
    db.select({ id: sites.id, domain: sites.domain, displayName: sites.displayName }).from(sites).where(eq(sites.workspaceId, workspaceId)),
  ]);
  const siteIds = siteRows.map((s) => s.id);
  const [teamGrants, userGrants] = siteIds.length
    ? await Promise.all([
        db
          .select({ siteId: siteTeamFeatures.siteId, teamId: siteTeamFeatures.teamId, feature: siteTeamFeatures.feature, level: siteTeamFeatures.level })
          .from(siteTeamFeatures)
          .where(inArray(siteTeamFeatures.siteId, siteIds)),
        db
          .select({ siteId: siteUserFeatures.siteId, userId: siteUserFeatures.userId, feature: siteUserFeatures.feature, level: siteUserFeatures.level })
          .from(siteUserFeatures)
          .where(inArray(siteUserFeatures.siteId, siteIds)),
      ])
    : [[], []];

  const mode: AccessMode = ws?.mode === "restricted" ? "restricted" : "open";
  const siteViews: SiteAccessView[] = siteRows.map((site) => {
    const teamsMap: Record<string, Record<string, string>> = {};
    for (const g of teamGrants.filter((x) => x.siteId === site.id)) (teamsMap[g.teamId] ??= {})[g.feature] = g.level;
    const usersMap: Record<string, Record<string, string>> = {};
    for (const g of userGrants.filter((x) => x.siteId === site.id)) (usersMap[g.userId] ??= {})[g.feature] = g.level;
    return { ...site, teams: teamsMap, users: usersMap };
  });
  return { mode, teamsEnabled: limitsFor(plan).teams, features: FEATURES, sites: siteViews };
}

/** Everyone in the workspace, for the pickers. */
export async function listWorkspacePeople(workspaceId: string) {
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}
