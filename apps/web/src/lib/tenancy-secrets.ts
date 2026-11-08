import { decryptSecret, encryptSecret, keyring } from "./secret-box";

/**
 * Site signing secrets. Thin wrappers over lib/secret-box (key ids, rotation, no development-key fallback in
 * production); the names are kept because tenancy.ts and its callers use them.
 */
export function siteSigningSecretKey(): string {
  return keyring()[0]!;
}

export const encryptSiteSigningSecret = (value: string): string => encryptSecret(value);

export const decryptSiteSigningSecret = (value: string | undefined): string | undefined => decryptSecret(value);
