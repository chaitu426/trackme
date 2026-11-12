import { limitsFor } from "@trackme/contracts";
import { canManageBilling } from "@/lib/billing";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug, listApiKeys, getWorkspaceUsage } from "@/lib/tenancy";
import { ApiKeysManager, type ApiKeySummary } from "@/components/api-keys-manager";
import { UsageQuotaCard } from "@/components/usage-quota-card";
import { db, workspaceMembers, workspaceInvites, users, eq, and } from "@trackme/db";
import { listWorkspaceAuditLogs } from "@/lib/audit";
import { OrganizationSettingsClient } from "./organization-settings-client";

export default async function OrganizationSettingsPage(props: {
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

  // Parallel load: members, pending invites, and recent workspace audit events
  const [memberRows, inviteRows, auditLogRows, apiKeyRows, usage] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspace.id)),

    db
      .select({
        id: workspaceInvites.id,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        status: workspaceInvites.status,
        expiresAt: workspaceInvites.expiresAt,
        createdAt: workspaceInvites.createdAt,
      })
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspace.id),
          eq(workspaceInvites.status, "pending")
        )
      ),

    listWorkspaceAuditLogs(workspace.id, 25),
    listApiKeys(workspace.id),
    getWorkspaceUsage(workspace.id),
  ]);

  const apiKeys: ApiKeySummary[] = apiKeyRows.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    createdAt: key.createdAt.toISOString(),
  }));

  const initialMembers = memberRows.map((m) => ({
    ...m,
    joinedAt: m.joinedAt.toISOString(),
  }));

  const initialInvites = inviteRows.map((i) => ({
    ...i,
    role: i.role as "admin" | "member" | "viewer",
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  }));

  return (
    <div className="w-full space-y-8">
      <OrganizationSettingsClient
        workspace={workspace}
        initialMembers={initialMembers}
        initialInvites={initialInvites}
        initialAuditLogs={limitsFor(usage.plan).auditLog ? auditLogRows : []}
        auditLocked={!limitsFor(usage.plan).auditLog}
        canUpgrade={await canManageBilling(user.id, workspace.companyId)}
        currentUserEmail={user.email}
      />
      <section id="usage">
        <UsageQuotaCard usage={usage} workspaceSlug={workspace.slug} />
      </section>
      <section id="tokens">
        <ApiKeysManager workspaceId={workspace.id} initialKeys={apiKeys} />
      </section>
    </div>
  );
}
