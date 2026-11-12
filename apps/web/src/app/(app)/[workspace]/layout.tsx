import { UpgradeHost } from "@/components/plan/upgrade-host";
import { canManageBilling } from "@/lib/billing";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listUserWorkspaces, listWorkspaceSites, requireWorkspaceBySlug } from "@/lib/tenancy";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const user = await requireUser();
  const { workspace: slug } = await params;

  // The user's workspace list does not depend on the workspace lookup, so fetch both at once.
  // A failed lookup becomes null here (rather than a rejection nobody awaits) and 404s below.
  const [found, userWorkspaces] = await Promise.all([
    requireWorkspaceBySlug(user.id, slug).catch(() => null),
    listUserWorkspaces(user.id),
  ]);
  if (!found) notFound();
  const workspace = found;
  const [siteList, canUpgrade] = await Promise.all([listWorkspaceSites(workspace.id), canManageBilling(user.id, workspace.companyId)]);
  const primarySite = siteList[0];
  const primarySiteDomain = primarySite?.domain ?? "";

  return (
    <DashboardShell
      workspace={{
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      }}
      workspaces={userWorkspaces}
      sites={siteList}
      primarySiteDomain={primarySiteDomain}
      user={{
        id: user.id,
        email: user.email,
      }}
    >
      {children}
      <UpgradeHost workspaceSlug={workspace.slug} canUpgrade={canUpgrade} />
    </DashboardShell>
  );
}
