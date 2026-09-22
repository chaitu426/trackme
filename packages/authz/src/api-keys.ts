import crypto from "node:crypto";
import { ApiKeyScope } from "@trackme/contracts";

export interface GeneratedApiKey {
  plaintext: string;
  keyHash: string;
  prefix: string;
}

const KEY_PREFIX = "gip_live_";

/**
 * Generate a cryptographically secure random API key
 */
export function generateApiKey(): GeneratedApiKey {
  const randomBytes = crypto.randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}${randomBytes}`;
  const keyHash = hashApiKey(plaintext);
  const prefix = plaintext.substring(0, 16);

  return {
    plaintext,
    keyHash,
    prefix,
  };
}

/**
 * Hash an API key using SHA-256 for secure storage at rest
 */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Securely verify an incoming API key against stored hash using constant-time comparison
 */
export function verifyApiKey(candidatePlaintext: string, storedHash: string): boolean {
  const candidateHash = hashApiKey(candidatePlaintext);
  const candidateBuf = Buffer.from(candidateHash, "hex");
  const storedBuf = Buffer.from(storedHash, "hex");

  if (candidateBuf.length !== storedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuf, storedBuf);
}

/**
 * Check if the provided scopes satisfy the requested scope
 */
export function hasScope(grantedScopes: ApiKeyScope[], requiredScope: ApiKeyScope): boolean {
  if (grantedScopes.includes("admin:workspace")) {
    return true;
  }
  return grantedScopes.includes(requiredScope);
}

