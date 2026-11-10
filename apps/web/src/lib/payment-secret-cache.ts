import { createTtlCache } from "./webhook-guard";

export interface CachedGatewaySecret {
  siteId: string;
  workspaceId: string;
  secret: string;
}

/**
 * The decrypted webhook secret per site key and gateway, held in memory for 30 seconds so a burst of webhooks costs one database
 * read. A "not connected" answer is cached as null. Changing or removing a gateway clears the site's entries in this process;
 * other instances pick the change up when their entries expire, so a rotated secret takes effect everywhere within 30 seconds.
 */
export const secretCache = createTtlCache<CachedGatewaySecret | null>(30_000);

export function forgetGatewaySecrets(siteId: string): void {
  // Entries for a site that was not connected hold null, so they are dropped with the rest on any change of gateways.
  secretCache.deleteWhere((v) => v === null || v.siteId === siteId);
}
