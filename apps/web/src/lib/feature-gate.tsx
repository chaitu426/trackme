import type { ReactNode } from "react";
import { ACCESS_DENIED_CODE, AppError, type Feature } from "@trackme/contracts";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite, requireWorkspaceBySlug, listWorkspaceSites } from "@/lib/tenancy";
import { NoAccess } from "@/components/plan/no-access";

/**
 * The page-level half of per-site feature access. Each feature area has a small layout that calls this: if the person's
 * teams do not include the feature on this site, it returns the "no access" panel to render instead of the page. Any other
 * failure (an unknown site, say) returns null and the page itself decides, as it always did.
 *
 * The same rule is enforced again by the API routes, so a page that is somehow reached still cannot load data.
 */
export async function gateSection(params: Promise<{ workspace: string; site: string }>, feature: Feature): Promise<ReactNode | null> {
  const user = await requireUser();
  const { workspace, site } = await params;
  try {
    await requireDashboardSite(user.id, workspace, site, feature);
    return null;
  } catch (error) {
    if (error instanceof AppError && error.code === ACCESS_DENIED_CODE) return <NoAccess feature={feature} workspaceSlug={workspace} />;
    return null;
  }
}

/** The workspace overview shows the primary site, so it is guarded by that site's traffic access. */
export async function gateOverview(params: Promise<{ workspace: string }>): Promise<ReactNode | null> {
  const user = await requireUser();
  const { workspace: slug } = await params;
  const workspace = await requireWorkspaceBySlug(user.id, slug).catch(() => null);
  if (!workspace) return null;
  const [primary] = await listWorkspaceSites(workspace.id);
  if (!primary) return null;
  return gateSection(Promise.resolve({ workspace: slug, site: primary.domain }), "acquisition");
}
