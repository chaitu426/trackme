import {
  ACCESS_DENIED_CODE,
  AppError,
  FEATURE_INFO,
  FeatureSchema,
  AccessLevelSchema,
  effectiveLevel,
  explainAccess,
  limitsFor,
  visibleFeatures,
  type AccessInput,
  type AccessLevel,
  type Feature,
  type FeatureGrant,
  type NamedGrant,
  WorkspaceRoleSchema,
  type WorkspaceRole,
} from "@trackme/contracts";
import { db, workspaces, workspaceMembers, companies, companyMembers, teams, teamMembers, siteTeamFeatures, siteUserFeatures, eq, and } from "@trackme/db";

/** Who is asking: enough to resolve their access. API keys carry no team, so they are never restricted by teams. */
export interface Actor {
  userId: string;
  role: WorkspaceRole;
  workspaceId: string;
}

const CACHE_TTL_SECONDS = 30;

interface Loaded {
  restricted: boolean;
  grants: FeatureGrant[];
}

function parseGrants(rows: { feature: string; level: string }[]): FeatureGrant[] {
  return rows.flatMap((row) => {
    const feature = FeatureSchema.safeParse(row.feature);
    const level = AccessLevelSchema.safeParse(row.level);
    return feature.success && level.success ? [{ feature: feature.data, level: level.data }] : [];
  });
}

/** Whether this workspace is in restricted mode right now: switched on, and the plan still includes teams. */
async function workspaceRestricted(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ mode: workspaces.accessMode, plan: companies.plan })
    .from(workspaces)
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return !!row && row.mode === "restricted" && limitsFor(row.plan).teams;
}

async function loadFromDb(userId: string, workspaceId: string, siteId: string): Promise<Loaded> {
  if (!(await workspaceRestricted(workspaceId))) return { restricted: false, grants: [] };
  const [viaTeams, direct] = await Promise.all([
    db
      .select({ feature: siteTeamFeatures.feature, level: siteTeamFeatures.level })
      .from(siteTeamFeatures)
      .innerJoin(teamMembers, eq(teamMembers.teamId, siteTeamFeatures.teamId))
      .where(and(eq(siteTeamFeatures.siteId, siteId), eq(teamMembers.userId, userId))),
    db
      .select({ feature: siteUserFeatures.feature, level: siteUserFeatures.level })
      .from(siteUserFeatures)
      .where(and(eq(siteUserFeatures.siteId, siteId), eq(siteUserFeatures.userId, userId))),
  ]);
  return { restricted: true, grants: [...parseGrants(viaTeams), ...parseGrants(direct)] };
}

const versionKey = (workspaceId: string) => `access:ver:${workspaceId}`;
const entryKey = (version: string, userId: string, siteId: string) => `access:${version}:${userId}:${siteId}`;

// Loaded lazily: ./redis connects at import time, which tests must not trigger.
async function cacheRedis() {
  return (await import("./redis")).getRedis("cache");
}

/**
 * Any change to teams, members, grants or the access mode bumps the workspace's version, which makes every cached entry
 * for it unreachable at once. Reads then cost one Redis round trip for the version and one for the entry. A cache that
 * is down is never an error: the database answers instead.
 */
export async function bumpAccessVersion(workspaceId: string): Promise<void> {
  try {
    await (await cacheRedis()).incr(versionKey(workspaceId));
  } catch {
    // the 30 s lifetime of an entry bounds how long a stale one can live
  }
}

async function load(actor: Actor, siteId: string): Promise<Loaded> {
  // Whole-workspace roles never depend on grants, so they skip the lookup entirely.
  if (actor.role === "owner" || actor.role === "admin") return { restricted: false, grants: [] };
  if (actor.userId.startsWith("api-key:")) return { restricted: false, grants: [] };

  try {
    const redis = await cacheRedis();
    const version = (await redis.get(versionKey(actor.workspaceId))) ?? "0";
    const key = entryKey(version, actor.userId, siteId);
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as Loaded;
    const loaded = await loadFromDb(actor.userId, actor.workspaceId, siteId);
    await redis.set(key, JSON.stringify(loaded), "EX", CACHE_TTL_SECONDS);
    return loaded;
  } catch {
    return loadFromDb(actor.userId, actor.workspaceId, siteId);
  }
}

export async function siteAccessInput(actor: Actor, siteId: string): Promise<AccessInput> {
  const { restricted, grants } = await load(actor, siteId);
  return { role: actor.role, restricted, grants };
}

/** What the actor may do with a feature on a site, or null for nothing. */
export async function featureLevel(actor: Actor, siteId: string, feature: Feature): Promise<AccessLevel | null> {
  return effectiveLevel(await siteAccessInput(actor, siteId), feature);
}

/** The features the actor can open on a site, for the sidebar. */
export async function featuresFor(actor: Actor, siteId: string): Promise<Feature[]> {
  return visibleFeatures(await siteAccessInput(actor, siteId));
}

export function accessDenied(feature: Feature, level: AccessLevel): AppError {
  const what = FEATURE_INFO[feature].label;
  return new AppError(
    403,
    ACCESS_DENIED_CODE,
    level === "manage"
      ? `Your team can view ${what} on this site but not change it. Ask a workspace admin for edit access.`
      : `Your team does not have access to ${what} on this site. Ask a workspace admin to add it.`
  );
}

/** Throws 403 unless the actor has at least `level` on the feature for this site. */
export async function requireFeature(actor: Actor, siteId: string, feature: Feature, level: AccessLevel = "view"): Promise<void> {
  const have = await featureLevel(actor, siteId, feature);
  if (have === null || (level === "manage" && have !== "manage")) {
    throw accessDenied(feature, have === null ? "view" : level);
  }
}

/** What a request needs of a feature, from the permission it already asks for: reading needs view; anything else needs manage. */
export function levelForPermission(permission: string): AccessLevel {
  return permission === "analytics:read" ? "view" : "manage";
}

/**
 * Why someone has the access they have on a site: their role, then each team and personal grant that reaches the
 * level they end up with. For the admin's "view as" panel. A company owner who is not in the workspace is an owner.
 */
export async function explainFor(workspaceId: string, userId: string, siteId: string) {
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  const [owner] = member
    ? []
    : await db
        .select({ role: companyMembers.role })
        .from(companyMembers)
        .innerJoin(workspaces, eq(workspaces.companyId, companyMembers.companyId))
        .where(and(eq(workspaces.id, workspaceId), eq(companyMembers.userId, userId), eq(companyMembers.role, "owner")))
        .limit(1);
  if (!member && !owner) throw new AppError(404, "MEMBER_NOT_FOUND", "That person is not in this workspace.");
  const roleParsed = WorkspaceRoleSchema.safeParse(member ? member.role : "owner");
  const role: WorkspaceRole = roleParsed.success ? roleParsed.data : "viewer";

  const restricted = await workspaceRestricted(workspaceId);
  const [viaTeams, direct] = await Promise.all([
    db
      .select({ team: teams.name, feature: siteTeamFeatures.feature, level: siteTeamFeatures.level })
      .from(siteTeamFeatures)
      .innerJoin(teamMembers, eq(teamMembers.teamId, siteTeamFeatures.teamId))
      .innerJoin(teams, eq(teams.id, siteTeamFeatures.teamId))
      .where(and(eq(siteTeamFeatures.siteId, siteId), eq(teamMembers.userId, userId))),
    db
      .select({ feature: siteUserFeatures.feature, level: siteUserFeatures.level })
      .from(siteUserFeatures)
      .where(and(eq(siteUserFeatures.siteId, siteId), eq(siteUserFeatures.userId, userId))),
  ]);
  const named: NamedGrant[] = [
    ...viaTeams.flatMap((r) => parseGrants([r]).map((g) => ({ ...g, team: r.team }))),
    ...parseGrants(direct).map((g) => ({ ...g, team: null })),
  ];
  return { role, restricted, features: explainAccess({ role, restricted }, named) };
}
