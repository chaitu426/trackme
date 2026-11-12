import { WorkspaceRole, AppError } from "@trackme/contracts";
import { API_KEY_DENIED, Permission, hasPermission } from "./permissions.js";

export interface TenantContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  siteId?: string;
  /** Who is acting: a signed-in person, or an API key. Defaults to a person. */
  principal?: "user" | "api_key";
}

/**
 * Enforce that the active tenant context possesses the required permission
 */
export function assertPermission(ctx: TenantContext, permission: Permission): void {
  if (ctx.principal === "api_key" && API_KEY_DENIED.has(permission)) {
    throw new AppError(403, "FORBIDDEN", `API keys cannot use '${permission}'. Sign in as a member instead.`);
  }
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
