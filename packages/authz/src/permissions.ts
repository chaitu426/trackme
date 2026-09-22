import { WorkspaceRole } from "@trackme/contracts";

export type Permission =
  | "workspace:manage"
  | "workspace:billing"
  | "workspace:members"
  | "sites:create"
  | "sites:update"
  | "sites:delete"
  | "goals:manage"
  | "analytics:read"
  | "api_keys:manage"
  | "exports:create";

const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<Permission>> = {
  owner: new Set<Permission>([
    "workspace:manage",
    "workspace:billing",
    "workspace:members",
    "sites:create",
    "sites:update",
    "sites:delete",
    "goals:manage",
    "analytics:read",
    "api_keys:manage",
    "exports:create",
  ]),
  admin: new Set<Permission>([
    "workspace:manage",
    "workspace:members",
    "sites:create",
    "sites:update",
    "sites:delete",
    "goals:manage",
    "analytics:read",
    "api_keys:manage",
    "exports:create",
  ]),
  member: new Set<Permission>([
    "sites:create",
    "sites:update",
    "goals:manage",
    "analytics:read",
    "exports:create",
  ]),
  viewer: new Set<Permission>(["analytics:read"]),
};

/**
 * Check if a workspace role has a specific permission
 */
export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.has(permission) : false;
}

