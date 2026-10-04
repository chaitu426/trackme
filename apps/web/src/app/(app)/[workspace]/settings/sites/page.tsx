import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug, listWorkspaceSites } from "@/lib/tenancy";
import { env } from "@trackme/config";
import { WorkspaceSitesClient } from "./workspace-sites-client";

export default async function WorkspaceSitesPage(props: {
  params: Promise<{ workspace: string }>;
}) {
  const user = await requireUser();
  const { workspace: slug } = await props.params;

  let workspace;
  try {
    workspace = await requireWorkspaceBySlug(user.id, slug);
  } catch {
    notFound();
  }

  const rawSites = await listWorkspaceSites(workspace.id);
  const initialSites = rawSites.map((s) => ({
    id: s.id,
    domain: s.domain,
    displayName: s.displayName,
    publicKey: s.publicKey || "",
    createdAt: new Date().toISOString(),
  }));

  return (
    <WorkspaceSitesClient
      workspace={workspace}
      initialSites={initialSites}
      appUrl={env.APP_URL}
      ingestionUrl={env.INGESTION_URL}
    />
  );
}
