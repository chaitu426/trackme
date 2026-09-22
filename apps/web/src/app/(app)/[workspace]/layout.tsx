import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listWorkspaceSites, requireWorkspaceBySlug } from "@/lib/tenancy";
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

  let workspace: Awaited<ReturnType<typeof requireWorkspaceBySlug>>;
  try {
    workspace = await requireWorkspaceBySlug(user.id, slug);
  } catch {
    notFound();
  }

  const siteList = await listWorkspaceSites(workspace.id);
  const primarySite = siteList[0];
  const primarySiteDomain = primarySite?.domain ?? "";

  return (
    <DashboardShell
      workspace={{
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      }}
      primarySiteDomain={primarySiteDomain}
      user={{
        id: user.id,
        email: user.email,
      }}
    >
      {children}
    </DashboardShell>
  );
}
