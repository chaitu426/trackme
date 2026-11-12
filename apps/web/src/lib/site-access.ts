import type { NextRequest } from "next/server";
import { AppError } from "@trackme/contracts";
import type { Permission } from "@trackme/authz";
import { db, sites, eq } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";

/**
 * Resolves a site and authorises the caller for it, the way the per-site API routes do:
 * the site gives the workspace, and the caller needs the permission in that workspace.
 */
export async function authorizeSite(
  request: NextRequest,
  siteId: string,
  permission: Permission
): Promise<{ siteId: string; workspaceId: string; userId: string | null }> {
  const [siteRow] = await db
    .select({ id: sites.id, workspaceId: sites.workspaceId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!siteRow) {
    throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
  }
  const ctx = await authenticateRequest(request, siteRow.workspaceId, permission);
  return { siteId, workspaceId: siteRow.workspaceId, userId: ctx.userId ?? null };
}
