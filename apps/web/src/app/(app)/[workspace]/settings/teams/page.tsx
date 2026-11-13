import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { hasPermission } from "@trackme/authz";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug } from "@/lib/tenancy";
import { canManageBilling } from "@/lib/billing";
import { listTeams, listWorkspacePeople, loadAccessMatrix } from "@/lib/teams-data";
import { PageHeader } from "@/components/ui/page-header";
import { Empty } from "@/components/ui/empty";
import { LockedFeature } from "@/components/plan/locked-feature";
import { TeamsClient } from "./teams-client";

export const metadata: Metadata = { title: "Teams & access" };

export default async function TeamsPage(props: { params: Promise<{ workspace: string }> }) {
  const user = await requireUser();
  const { workspace: slug } = await props.params;
  const workspace = await requireWorkspaceBySlug(user.id, slug).catch(() => null);
  if (!workspace) notFound();

  if (!hasPermission(workspace.role, "members:read")) {
    return (
      <div className="w-full space-y-6">
        <PageHeader title="Teams & access" art="steps">Who works on what in this workspace.</PageHeader>
        <Empty title="Teams are visible to members and above" art="steps">
          Ask a workspace admin which team you are on and what it can open.
        </Empty>
      </div>
    );
  }

  const matrix = await loadAccessMatrix(workspace.id);
  if (!matrix.teamsEnabled) {
    return (
      <div className="w-full space-y-6">
        <PageHeader title="Teams & access" art="steps">Group people into teams and give each team the parts of the product it needs.</PageHeader>
        <LockedFeature title="Teams and per-site access are part of Pro" workspaceSlug={workspace.slug} art="steps" canUpgrade={await canManageBilling(user.id, workspace.companyId)}>
          Create Marketing, Engineering, QA and Finance teams, then choose per website what each can see: traffic, errors, releases, payments and more.
        </LockedFeature>
      </div>
    );
  }

  const [teams, people] = await Promise.all([listTeams(workspace.id), listWorkspacePeople(workspace.id)]);

  return (
    <TeamsClient
      workspace={{ id: workspace.id, slug: workspace.slug }}
      canManage={hasPermission(workspace.role, "workspace:members")}
      currentUserId={user.id}
      initialMode={matrix.mode}
      sites={matrix.sites}
      teams={teams}
      people={people.map((p) => ({ id: p.id, name: p.name ?? p.email, email: p.email, role: p.role }))}
    />
  );
}
