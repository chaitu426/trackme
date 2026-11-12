import { cache } from "react";
import { NextRequest } from "next/server";
import {
  AppError,
  ApiKeyScopeSchema,
  SiteSettingsSchema,
  WorkspaceRoleSchema,
  CompanyRoleSchema,
  type ApiKeyScope,
  type SiteSettings,
  type WorkspaceRole,
} from "@trackme/contracts";
import {
  assertPermission,
  assertWorkspaceMatch,
  effectiveWorkspaceRole,
  hashApiKey,
  hasScope,
  type Permission,
  type TenantContext,
} from "@trackme/authz";
import {
  db,
  and,
  desc,
  eq,
  sql,
  apiKeys,
  sites,
  usageCounters,
  workspaceMembers,
  workspaces,
  companyMembers,
  or,
} from "@trackme/db";
import { requireApiUser } from "./auth";
import { checkRateLimit } from "./rate-limit";
import { getRedis } from "./redis";
import { cachedMembershipRole, cachedSiteInWorkspace } from "./authz-cache";
import { decryptSiteSigningSecret, encryptSiteSigningSecret } from "./tenancy-secrets";

export { decryptSiteSigningSecret, encryptSiteSigningSecret, siteSigningSecretKey } from "./tenancy-secrets";

function encryptSiteSettingsSecret(settings: SiteSettings): SiteSettings {
  if (!settings.signingSecret) {
    return settings;
  }
  return { ...settings, signingSecret: encryptSiteSigningSecret(settings.signingSecret) };
}

function decryptSiteSettingsSecret(settings: SiteSettings): SiteSettings {
  if (!settings.signingSecret) {
    return settings;
  }
  return { ...settings, signingSecret: decryptSiteSigningSecret(settings.signingSecret) };
}

function parseRole(role: string): WorkspaceRole {
  const parsed = WorkspaceRoleSchema.safeParse(role);
  if (!parsed.success) {
    throw new AppError(403, "FORBIDDEN", "Membership role is invalid");
  }
  return parsed.data;
}

function parseScopes(raw: string[] | null): ApiKeyScope[] {
  if (!raw) {
    return [];
  }
  return raw.flatMap((value) => {
    const parsed = ApiKeyScopeSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function roleFromApiKeyScopes(scopes: ApiKeyScope[]): WorkspaceRole {
  if (hasScope(scopes, "admin:workspace")) {
    return "admin";
  }
  if (hasScope(scopes, "read:analytics")) {
    return "viewer";
  }
  throw new AppError(403, "FORBIDDEN", "API key is missing analytics read scope");
}

/** Direct membership combined with the company role. Unknown stored values grant nothing. */
function resolveRole(direct: string | null, company: string | null): WorkspaceRole | null {
  const d = WorkspaceRoleSchema.safeParse(direct);
  const c = CompanyRoleSchema.safeParse(company);
  return effectiveWorkspaceRole(d.success ? d.data : null, c.success ? c.data : null);
}

async function loadMembershipContext(
  userId: string,
  workspaceId: string,
  options: { cache?: boolean } = {}
): Promise<TenantContext> {
  if (options.cache) {
    const role = await cachedMembershipRole(userId, workspaceId, async () => (await queryMembership(userId, workspaceId)).role);
    return { userId, workspaceId, role: parseRole(role), principal: "user" };
  }
  return queryMembership(userId, workspaceId);
}

async function queryMembership(userId: string, workspaceId: string): Promise<TenantContext> {
  // One query: the person's direct membership, and their role in the company that owns the workspace.
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      role: workspaceMembers.role,
      companyRole: companyMembers.role,
    })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .leftJoin(
      companyMembers,
      and(eq(companyMembers.companyId, workspaces.companyId), eq(companyMembers.userId, userId))
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const row = rows[0];
  const role = row ? resolveRole(row.role, row.companyRole) : null;
  if (!row || !role) {
    throw new AppError(403, "TENANT_ISOLATION_VIOLATION", "Cross-workspace access is strictly forbidden");
  }

  return { userId, workspaceId: row.workspaceId, role, principal: "user" };
}

/** Per caller (a signed-in user, or one API key) per minute, across every authenticated endpoint. */
const API_CALLS_PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 600);

/**
 * Meters every authenticated call. Before this only the sign-in routes were limited, so invitations, alert
 * tests, previews, search and all analytics endpoints could be hammered without bound. Doing it here, where
 * identity is established, means a new endpoint cannot forget it.
 */
async function enforceCallerLimit(ctx: TenantContext): Promise<void> {
  await checkRateLimit(`api_caller:${ctx.userId}`, API_CALLS_PER_MINUTE, 60, "Too many requests. Slow down and retry shortly.");
}

/** Records when an API key was last used (at most once per 10 minutes per key). Never fails a request. */
async function touchApiKey(id: string): Promise<void> {
  try {
    const first = await getRedis("ratelimit").set(`apikey_touch:${id}`, "1", "EX", 600, "NX");
    if (first) await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  } catch {
    // usage tracking is best effort
  }
}

async function resolveApiKey(request: NextRequest): Promise<{ id: string; workspaceId: string; scopes: ApiKeyScope[] } | null> {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid authorization header");
  }

  const keyHash = hashApiKey(token);
  const rows = await db
    .select({
      workspaceId: apiKeys.workspaceId,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      id: apiKeys.id,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const apiKey = rows[0];
  if (!apiKey) {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid API key");
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, "UNAUTHENTICATED", "API key has expired");
  }

  void touchApiKey(apiKey.id);
  return { id: apiKey.id, workspaceId: apiKey.workspaceId, scopes: parseScopes(apiKey.scopes) };
}

async function authenticateApiKey(
  request: NextRequest,
  workspaceId: string
): Promise<TenantContext | null> {
  const apiKey = await resolveApiKey(request);
  if (!apiKey) {
    return null;
  }

  const ctx: TenantContext = {
    userId: `api-key:${apiKey.id}`,
    workspaceId: apiKey.workspaceId,
    role: roleFromApiKeyScopes(apiKey.scopes),
    principal: "api_key",
  };

  assertWorkspaceMatch(ctx, workspaceId);
  return ctx;
}

/**
 * A CI job reporting a deploy. The key must carry `write:deploys` (or admin) and nothing else is granted:
 * no session, no analytics access. The workspace comes from the key, never from the request.
 */
export async function authenticateDeployKey(request: NextRequest): Promise<{ workspaceId: string; keyId: string }> {
  const apiKey = await resolveApiKey(request);
  if (!apiKey) {
    throw new AppError(401, "UNAUTHENTICATED", "A Bearer API key with the write:deploys scope is required");
  }
  if (!hasScope(apiKey.scopes, "write:deploys")) {
    throw new AppError(403, "FORBIDDEN", "API key is missing the write:deploys scope");
  }
  await enforceCallerLimit({ userId: `api-key:${apiKey.id}`, workspaceId: apiKey.workspaceId, role: "viewer" });
  return { workspaceId: apiKey.workspaceId, keyId: apiKey.id };
}

export async function authenticateRequest(
  request: NextRequest,
  workspaceId: string,
  permission: Permission,
  options: { cacheMembership?: boolean } = {}
): Promise<TenantContext> {
  const apiKeyContext = await authenticateApiKey(request, workspaceId);
  const ctx =
    apiKeyContext ??
    (await loadMembershipContext((await requireApiUser(request)).id, workspaceId, { cache: options.cacheMembership === true }));

  assertWorkspaceMatch(ctx, workspaceId);
  assertPermission(ctx, permission);
  await enforceCallerLimit(ctx);
  return ctx;
}

export async function requireMetricsAccess(
  request: NextRequest,
  workspaceId: string,
  siteId: string
): Promise<TenantContext> {
  // Read-only analytics path: membership (30 s) and site ownership (10 min) are
  // cached, with explicit invalidation on member removal/role change and site delete.
  const ctx = await authenticateRequest(request, workspaceId, "analytics:read", { cacheMembership: true });

  const belongs = await cachedSiteInWorkspace(siteId, workspaceId, async () => {
    const siteRows = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
      .limit(1);
    return siteRows.length > 0;
  });
  if (!belongs) {
    throw new AppError(403, "TENANT_ISOLATION_VIOLATION", "Site does not belong to this workspace");
  }

  return {
    ...ctx,
    siteId,
  };
}

export const requireWorkspaceBySlug = cache(async (userId: string, slug: string) => {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      companyId: workspaces.companyId,
      role: workspaceMembers.role,
      companyRole: companyMembers.role,
    })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .leftJoin(
      companyMembers,
      and(eq(companyMembers.companyId, workspaces.companyId), eq(companyMembers.userId, userId))
    )
    .where(eq(workspaces.slug, slug))
    .limit(1);

  const workspace = rows[0];
  const role = workspace ? resolveRole(workspace.role, workspace.companyRole) : null;
  if (!workspace || !role) {
    throw new AppError(403, "TENANT_ISOLATION_VIOLATION", "Workspace not found for this account");
  }

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    companyId: workspace.companyId,
    role,
  };
});

export const listWorkspaceSites = cache(async (workspaceId: string) => {
  return db
    .select({
      id: sites.id,
      domain: sites.domain,
      displayName: sites.displayName,
      publicKey: sites.publicKey,
    })
    .from(sites)
    .where(eq(sites.workspaceId, workspaceId));
});

export const listUserWorkspaces = cache(async (userId: string) => {
  // Workspaces the person belongs to directly, plus every workspace of a company they own.
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      companyId: workspaces.companyId,
      role: workspaceMembers.role,
      companyRole: companyMembers.role,
    })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .leftJoin(
      companyMembers,
      and(eq(companyMembers.companyId, workspaces.companyId), eq(companyMembers.userId, userId))
    )
    .where(or(eq(workspaceMembers.userId, userId), eq(companyMembers.userId, userId)));

  return rows.flatMap((row) => {
    const role = resolveRole(row.role, row.companyRole);
    return role ? [{ id: row.id, name: row.name, slug: row.slug, companyId: row.companyId, role }] : [];
  });
});

export type DashboardSite = {
  id: string;
  workspaceId: string;
  domain: string;
  displayName: string;
  publicKey: string;
  settings: SiteSettings;
};

const SITE_COLUMNS = {
  id: sites.id,
  workspaceId: sites.workspaceId,
  domain: sites.domain,
  displayName: sites.displayName,
  publicKey: sites.publicKey,
  settings: sites.settings,
};

function publicSettings(settings: SiteSettings): SiteSettings {
  const plaintextSecret = decryptSiteSigningSecret(settings.signingSecret);
  const { signingSecret: _secret, ...rest } = settings;
  return SiteSettingsSchema.parse({
    ...rest,
    signingSecretHash:
      settings.signingSecretHash ||
      (plaintextSecret ? hashApiKey(plaintextSecret) : undefined),
  });
}

function toDashboardSite(row: {
  id: string;
  workspaceId: string;
  domain: string;
  displayName: string;
  publicKey: string;
  settings: unknown;
}): DashboardSite {
  const settings = SiteSettingsSchema.parse(row.settings ?? {});
  return { ...row, settings: publicSettings(settings) };
}

async function getSiteSettingsRaw(siteId: string): Promise<SiteSettings | null> {
  const rows = await db
    .select({ settings: sites.settings })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!rows[0]) return null;
  return decryptSiteSettingsSecret(SiteSettingsSchema.parse(rows[0].settings ?? {}));
}

export const requireSiteByDomain = cache(async (
  workspaceId: string,
  domain: string
): Promise<DashboardSite> => {
  const rows = await db
    .select(SITE_COLUMNS)
    .from(sites)
    .where(and(eq(sites.workspaceId, workspaceId), eq(sites.domain, domain)))
    .limit(1);

  const site = rows[0];
  if (!site) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found in this workspace");
  }

  return toDashboardSite(site);
});

/**
 * Session-based authorization for server-rendered dashboard pages: verifies
 * workspace membership, the analytics:read permission, and that the site
 * belongs to that workspace, all from the URL's [workspace]/[site] segments.
 */
export async function requireDashboardSite(
  userId: string,
  workspaceSlug: string,
  siteDomain: string
) {
  const workspace = await requireWorkspaceBySlug(userId, workspaceSlug);
  assertPermission({ userId, workspaceId: workspace.id, role: workspace.role }, "analytics:read");
  const site = await requireSiteByDomain(workspace.id, siteDomain);
  return { workspace, site };
}

/**
 * Resolves the workspace's first/primary site for pages that aren't scoped
 * to a specific [site] URL segment (e.g. the workspace overview).
 */
export async function requirePrimarySite(userId: string, workspaceSlug: string) {
  const workspace = await requireWorkspaceBySlug(userId, workspaceSlug);
  assertPermission({ userId, workspaceId: workspace.id, role: workspace.role }, "analytics:read");

  const siteList = await listWorkspaceSites(workspace.id);
  const primary = siteList[0];
  if (!primary) {
    throw new AppError(404, "NO_SITES", "This workspace has no sites yet");
  }

  const site = await getSiteById(primary.id);
  if (!site) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found");
  }

  return { workspace, site };
}

export const getSiteById = cache(async (siteId: string): Promise<DashboardSite | null> => {
  const rows = await db.select(SITE_COLUMNS).from(sites).where(eq(sites.id, siteId)).limit(1);
  const site = rows[0];
  return site ? toDashboardSite(site) : null;
});

/**
 * Request-based authorization for site-scoped API routes (settings,
 * verification) that are only ever called from the dashboard's own
 * session, not from third-party API keys.
 */
export async function requireSiteAccess(
  request: NextRequest,
  siteId: string,
  permission: Permission = "analytics:read"
): Promise<{ ctx: TenantContext; site: DashboardSite }> {
  const site = await getSiteById(siteId);
  if (!site) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found");
  }

  const user = await requireApiUser(request);
  const ctx = await loadMembershipContext(user.id, site.workspaceId);
  assertPermission(ctx, permission);
  await enforceCallerLimit(ctx);

  return { ctx, site };
}

export async function requireWorkspaceMember(
  request: NextRequest,
  workspaceId: string,
  permission: Permission
): Promise<TenantContext> {
  const user = await requireApiUser(request);
  const ctx = await loadMembershipContext(user.id, workspaceId);
  assertPermission(ctx, permission);
  return ctx;
}

export async function updateSiteSettings(
  siteId: string,
  patch: Partial<SiteSettings>
): Promise<DashboardSite> {
  const site = await getSiteById(siteId);
  if (!site) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found");
  }

  // Merge against raw settings so we never wipe signingSecret when it was
  // stripped from the public dashboard view.
  const current = (await getSiteSettingsRaw(siteId)) ?? site.settings;
  const merged = SiteSettingsSchema.parse({ ...current, ...patch });
  const persisted = encryptSiteSettingsSecret(merged);
  await db
    .update(sites)
    .set({ settings: persisted, updatedAt: new Date() })
    .where(eq(sites.id, siteId));

  const hashRows = await db
    .select({ publicKeyHash: sites.publicKeyHash })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (hashRows[0]?.publicKeyHash) {
    const { invalidateIngestSiteCache } = await import("./ingest-cache");
    await invalidateIngestSiteCache(hashRows[0].publicKeyHash);
  }

  return { ...site, settings: publicSettings(merged) };
}

/** Rotate the ingest HMAC secret. Returns plaintext once; stores server-side only. */
export async function rotateIngestSigningSecret(siteId: string): Promise<{
  site: DashboardSite;
  signingSecret: string;
}> {
  const site = await getSiteById(siteId);
  if (!site) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found");
  }

  const { randomBytes } = await import("node:crypto");
  const signingSecret = `gis_${randomBytes(24).toString("base64url")}`;
  const current = (await getSiteSettingsRaw(siteId)) ?? site.settings;
  const merged = SiteSettingsSchema.parse({
    ...current,
    signingRequired: true,
    signingSecret,
    signingSecretHash: hashApiKey(signingSecret),
  });
  const persisted = encryptSiteSettingsSecret(merged);

  await db
    .update(sites)
    .set({ settings: persisted, updatedAt: new Date() })
    .where(eq(sites.id, siteId));

  const hashRows = await db
    .select({ publicKeyHash: sites.publicKeyHash })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (hashRows[0]?.publicKeyHash) {
    const { invalidateIngestSiteCache } = await import("./ingest-cache");
    await invalidateIngestSiteCache(hashRows[0].publicKeyHash);
  }

  return {
    site: { ...site, settings: publicSettings(merged) },
    signingSecret,
  };
}

/**
 * Looks up a site by its public dashboard share slug. No auth required by
 * design (this backs the public /share/[slug] page), but only sites that
 * have explicitly opted in via publicDashboardEnabled are returned.
 */
export async function listApiKeys(workspaceId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(desc(apiKeys.createdAt));
}

export const getPublicSite = cache(async (slug: string): Promise<DashboardSite | null> => {
  const rows = await db
    .select(SITE_COLUMNS)
    .from(sites)
    .where(
      and(
        sql`${sites.settings}->>'publicDashboardSlug' = ${slug}`,
        sql`(${sites.settings}->>'publicDashboardEnabled')::boolean = true`
      )
    )
    .limit(1);

  const site = rows[0];
  return site ? toDashboardSite(site) : null;
});

export type WorkspaceUsage = {
  plan: string;
  monthlyQuota: number;
  currentUsage: number;
  percentageUsed: number;
  period: string;
  status: "healthy" | "warning" | "exceeded";
};

export async function getWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const [wsRows, usageRows] = await Promise.all([
    db
      .select({
        plan: workspaces.plan,
        monthlyQuota: workspaces.monthlyEventQuota,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1),
    db
      .select({
        eventCount: sql<number>`coalesce(sum(${usageCounters.eventCount}), 0)`,
      })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.workspaceId, workspaceId),
          eq(usageCounters.period, currentPeriod)
        )
      ),
  ]);

  const ws = wsRows[0];
  const plan = ws?.plan ?? "starter";
  const monthlyQuota = ws?.monthlyQuota ?? 100_000;
  const currentUsage = Number(usageRows[0]?.eventCount ?? 0);
  const percentageUsed =
    monthlyQuota > 0
      ? Math.min(Math.round((currentUsage / monthlyQuota) * 1000) / 10, 100)
      : 0;

  let status: "healthy" | "warning" | "exceeded" = "healthy";
  if (currentUsage >= monthlyQuota) {
    status = "exceeded";
  } else if (percentageUsed >= 80) {
    status = "warning";
  }

  return {
    plan,
    monthlyQuota,
    currentUsage,
    percentageUsed,
    period: currentPeriod,
    status,
  };
}
