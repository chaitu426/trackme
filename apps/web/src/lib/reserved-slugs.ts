/**
 * Workspace slugs are the first segment of every dashboard URL (`/{slug}/overview`), so a workspace may not take a name that
 * is already a top-level route: it would be shadowed by the route, and the workspace would be unreachable. Keep this in step
 * with the folders directly under `src/app`.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "billing",
  "docs",
  "invite",
  "legal",
  "login",
  "logout",
  "onboarding",
  "pricing",
  "settings",
  "share",
  "signup",
  "t",
  "company",
  "admin",
  "app",
  "static",
  "public",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
