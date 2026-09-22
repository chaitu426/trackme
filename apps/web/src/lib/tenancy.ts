import { NextRequest } from "next/server";
import {
  AppError,
  ApiKeyScopeSchema,
  SiteSettingsSchema,
  WorkspaceRoleSchema,
  type ApiKeyScope,
  type SiteSettings,
  type WorkspaceRole,
} from "@trackme/contracts";
import {
  assertPermission,
  assertWorkspaceMatch,
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
} from "@trackme/db";
import { requireApiUser } from "./auth";

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

async function loadMembershipContext(userId: string, workspaceId: string): Promise<TenantContext> {
  const rows = await db
    .select({
      role: workspaceMembers.role,
      workspaceId: workspaceMembers.workspaceId,
    })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId))
    )
    .limit(1);

  const membership = rows[0];
  if (!membership) {
    throw new AppError(403, "TENANT_ISOLATION_VIOLATION", "Cross-workspace access is strictly forbidden");
  }

  return {
    userId,
    workspaceId: membership.workspaceId,
    role: parseRole(membership.role),
  };
}

async function authenticateApiKey(
  request: NextRequest,
  workspaceId: string
): Promise<TenantContext | null> {
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

  const scopes = parseScopes(apiKey.scopes);
  const ctx: TenantContext = {
    userId: `api-key:${apiKey.id}`,
    workspaceId: apiKey.workspaceId,
    role: roleFromApiKeyScopes(scopes),
  };

  assertWorkspaceMatch(ctx, workspaceId);
  return ctx;
}

export async function requireMetricsAccess(
  request: NextRequest,
  workspaceId: string,
  siteId: string
): Promise<TenantContext> {
  const apiKeyContext = await authenticateApiKey(request, workspaceId);
  const ctx = apiKeyContext ?? (await loadMembershipContext((await requireApiUser(request)).id, workspaceId));

  assertWorkspaceMatch(ctx, workspaceId);
  assertPermission(ctx, "analytics:read");

  const siteRows = await db
    .select({
      id: sites.id,
      workspaceId: sites.workspaceId,
    })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId)))
    .limit(1);

  const site = siteRows[0];
  if (!site) {
    throw new AppError(403, "TENANT_ISOLATION_VIOLATION", "Site does not belong to this workspace");
  }

  return {
    ...ctx,
    siteId: site.id,
  };
}

export async function requireWorkspaceBySlug(userId: string, slug: string) {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .where(eq(workspaces.slug, slug))
    .limit(1);

  const workspace = rows[0];
  if (!workspace) {
    throw new AppError(403, "TENANT_ISOLATION_VIOLATION", "Workspace not found for this account");
  }

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role: parseRole(workspace.role),
  };
}

export async function listWorkspaceSites(workspaceId: string) {
  return db
    .select({
      id: sites.id,
      domain: sites.domain,
      displayName: sites.displayName,
    })
    .from(sites)
    .where(eq(sites.workspaceId, workspaceId));
}

export async function listUserWorkspaces(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    );
}

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
  const { signingSecret: _secret, ...rest } = settings;
  return SiteSettingsSchema.parse({
    ...rest,
    signingSecretHash:
      settings.signingSecretHash ||
      (settings.signingSecret ? hashApiKey(settings.signingSecret) : undefined),
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
  return SiteSettingsSchema.parse(rows[0].settings ?? {});
}

export async function requireSiteByDomain(
  workspaceId: string,
  domain: string
): Promise<DashboardSite> {
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
}

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

export async function getSiteById(siteId: string): Promise<DashboardSite | null> {
  const rows = await db.select(SITE_COLUMNS).from(sites).where(eq(sites.id, siteId)).limit(1);
  const site = rows[0];
  return site ? toDashboardSite(site) : null;
}

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
  await db
    .update(sites)
    .set({ settings: merged, updatedAt: new Date() })
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

  await db
    .update(sites)
    .set({ settings: merged, updatedAt: new Date() })
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

export async function getPublicSite(slug: string): Promise<DashboardSite | null> {
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
}

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
