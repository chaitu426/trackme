import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "@trackme/contracts";

const SITE_SIGNING_SECRET_PREFIX = "enc:v1:";

export function siteSigningSecretKey(): string {
  const key = process.env.SITE_SIGNING_SECRET_KEY ?? "dev-site-signing-secret-key-min-32-chars";
  if (key.length < 32) {
    throw new AppError(500, "CONFIG_ERROR", "SITE_SIGNING_SECRET_KEY must be at least 32 chars");
  }
  return key;
}

export function encryptSiteSigningSecret(value: string): string {
  if (!value || value.startsWith(SITE_SIGNING_SECRET_PREFIX)) {
    return value;
  }
  const key = createHash("sha256").update(siteSigningSecretKey()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SITE_SIGNING_SECRET_PREFIX}${Buffer.concat([iv, ciphertext, tag]).toString("base64url")}`;
}

export function decryptSiteSigningSecret(value: string | undefined): string | undefined {
  if (!value || !value.startsWith(SITE_SIGNING_SECRET_PREFIX)) {
    return value;
  }
  const key = createHash("sha256").update(siteSigningSecretKey()).digest();
  const payload = Buffer.from(value.slice(SITE_SIGNING_SECRET_PREFIX.length), "base64url");
  if (payload.length <= 28) {
    throw new AppError(500, "CONFIG_ERROR", "Site signing secret is corrupted");
  }
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(12, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
