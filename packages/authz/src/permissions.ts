import { WorkspaceRole } from "@trackme/contracts";

/**
 * The one permission vocabulary. Routes name the permission they need, with no aliases, and
 * `permissions.test.ts` fails if a route calls `authenticateRequest` without one.
 */
export type Permission =
  | "workspace:manage"
  | "workspace:billing"
  | "workspace:members"
  | "members:read"
  | "sites:create"
  | "sites:update"
  | "sites:delete"
  | "goals:manage"
  | "alerts:manage"
  | "analytics:read"
  | "api_keys:manage"
  | "exports:create"
  | "data:erase";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "workspace:manage",
  "workspace:billing",
  "workspace:members",
  "members:read",
  "sites:create",
  "sites:update",
  "sites:delete",
  "goals:manage",
  "alerts:manage",
  "analytics:read",
  "api_keys:manage",
  "exports:create",
  "data:erase",
];

const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<Permission>> = {
  owner: new Set<Permission>(ALL_PERMISSIONS),
  admin: new Set<Permission>(ALL_PERMISSIONS.filter((p) => p !== "workspace:billing")),
  member: new Set<Permission>([
    "sites:create",
    "sites:update",
    "goals:manage",
    "analytics:read",
    "exports:create",
    "members:read",
  ]),
  viewer: new Set<Permission>(["analytics:read"]),
};

/**
 * Things only a signed-in person may do, whatever scope an API key carries. An API key is a credential for
 * automation: it must not manage people, billing or other keys, or erase data.
 */
export const API_KEY_DENIED: ReadonlySet<Permission> = new Set<Permission>([
  "workspace:manage",
  "workspace:billing",
  "workspace:members",
  "members:read",
  "api_keys:manage",
  "data:erase",
]);

/**
 * Check if a workspace role has a specific permission
 */
export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.has(permission) : false;
}
