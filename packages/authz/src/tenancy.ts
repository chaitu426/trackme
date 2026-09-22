import { WorkspaceRole, AppError } from "@trackme/contracts";
import { Permission, hasPermission } from "./permissions.js";

export interface TenantContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  siteId?: string;
}

/**
 * Enforce that the active tenant context possesses the required permission
 */
export function assertPermission(ctx: TenantContext, permission: Permission): void {
  if (!hasPermission(ctx.role, permission)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `Role '${ctx.role}' does not have required permission '${permission}'`
    );
  }
}

/**
 * Enforce that the request targets the current tenant's workspace
 */
export function assertWorkspaceMatch(ctx: TenantContext, targetWorkspaceId: string): void {
  if (ctx.workspaceId !== targetWorkspaceId) {
    throw new AppError(
      403,
      "TENANT_ISOLATION_VIOLATION",
      "Cross-workspace access is strictly forbidden"
    );
  }
}

