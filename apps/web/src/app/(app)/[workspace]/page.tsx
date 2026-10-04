import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug, listWorkspaceSites } from "@/lib/tenancy";

export default async function WorkspaceRootPage(props: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await props.params;
  const user = await requireUser();

  let workspace;
  try {
    workspace = await requireWorkspaceBySlug(user.id, slug);
  } catch {
    notFound();
  }

  const siteList = await listWorkspaceSites(workspace.id);

  // If the workspace has sites configured, send directly to overview dashboard.
  // Otherwise, guide them to add their first website in settings/sites.
  if (siteList.length > 0) {
    redirect(`/${slug}/overview`);
  }

  redirect(`/${slug}/settings/sites`);
}
