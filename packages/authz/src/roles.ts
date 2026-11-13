import type { CompanyRole, WorkspaceRole } from "@trackme/contracts";

/** Higher outranks lower. Nobody may act on someone at or above their own rank, except the owner. */
export const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** The owner may invite anyone below them; an admin may only invite roles below admin. Ownership is never invited. */
export function canInviteRole(actor: WorkspaceRole, role: WorkspaceRole): boolean {
  if (role === "owner") return false;
  if (actor === "owner") return true;
  return ROLE_RANK[actor] > ROLE_RANK[role];
}

/**
 * Whether `actor` may change a member currently holding `current` to `next`. Moving ownership is not a role
 * change (see the transfer flow), so `next` may never be owner here, and an owner's role is never edited.
 */
export function canChangeRole(actor: WorkspaceRole, current: WorkspaceRole, next: WorkspaceRole): boolean {
  if (next === "owner" || current === "owner") return false;
  if (actor === "owner") return true;
  return ROLE_RANK[actor] > ROLE_RANK[current] && ROLE_RANK[actor] > ROLE_RANK[next];
}

/** Whether `actor` may remove a member holding `target`. The owner is never removable. */
export function canRemoveMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (target === "owner") return false;
  return actor === "owner" || ROLE_RANK[actor] > ROLE_RANK[target];
}

/**
 * The role a person acts with in a workspace, from their direct membership and their role in the owning company.
 * A company owner is an owner of every workspace in the company, whether or not they were added to it, so the
 * founder never loses control of a workspace an admin runs. Any other company role grants no workspace access.
 * Returns null when the person has no access at all.
 */
export function effectiveWorkspaceRole(
  direct: WorkspaceRole | null | undefined,
  company: CompanyRole | null | undefined
): WorkspaceRole | null {
  if (company === "owner") return "owner";
  return direct ?? null;
}
