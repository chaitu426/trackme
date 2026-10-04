import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireWorkspaceBySlug } from "@/lib/tenancy";
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
  const [memberRows, inviteRows, auditLogRows] = await Promise.all([
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
        token: workspaceInvites.token,
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
  ]);

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
    <OrganizationSettingsClient
      workspace={workspace}
      initialMembers={initialMembers}
      initialInvites={initialInvites}
      initialAuditLogs={auditLogRows}
      currentUserEmail={user.email}
    />
  );
}
