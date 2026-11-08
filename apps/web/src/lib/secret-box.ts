import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { AppError } from "@trackme/contracts";

/**
 * Encryption of secrets stored in the database (site signing secrets, alert-channel webhook URLs and secrets).
 *
 *   enc:v2:<key id>:<base64url( iv(12) | ciphertext | tag(16) )>      AES-256-GCM
 *
 * What changed from v1 ("enc:v1:", AES key = SHA-256 of the environment variable, no key identifier):
 *  - Keys have an id (the first 8 hex characters of the key's SHA-256), written into every value. A value says
 *    which key encrypted it, so the key can be rotated: put the new key in SITE_SIGNING_SECRET_KEY and the old
 *    one(s) in SITE_SIGNING_SECRET_KEY_PREVIOUS (comma separated); everything keeps decrypting, new writes use
 *    the new key, and `scripts/rotate-secrets.ts` re-encrypts what is stored. Retire the old key afterwards.
 *  - The AES key is derived with HKDF-SHA256 (salt = key id), not a bare hash.
 *  - There is no silent fallback to a public development key. In production a missing, short or default key
 *    stops the code that needs it; only outside production does the documented development key apply.
 * v1 values still decrypt (with any key in the ring) so nothing needs migrating before this is deployed.
 *
 * The Go ingestion edge decrypts the same values: services/ingestion-go/internal/site/resolver.go.
 */
const DEV_KEY = "dev-site-signing-secret-key-min-32-chars";
const V1 = "enc:v1:";
const V2 = "enc:v2:";
const INFO = "trackme/secret-box/v2";

const configError = (message: string) => new AppError(500, "CONFIG_ERROR", message);

/** The keys in use, current key first. */
export function keyring(env: NodeJS.ProcessEnv = process.env): string[] {
  const production = env.NODE_ENV === "production";
  const current = env.SITE_SIGNING_SECRET_KEY?.trim();
  const previous = (env.SITE_SIGNING_SECRET_KEY_PREVIOUS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const keys = [current, ...previous].filter((k): k is string => !!k);
  if (keys.length === 0) {
    if (production) throw configError("SITE_SIGNING_SECRET_KEY is not set");
    return [DEV_KEY];
  }
  for (const key of keys) {
    if (key.length < 32) throw configError("Secret keys must be at least 32 characters");
    if (production && key === DEV_KEY) throw configError("SITE_SIGNING_SECRET_KEY is the public development key");
  }
  return keys;
}

export const keyId = (secret: string): string => createHash("sha256").update(secret).digest("hex").slice(0, 8);

const deriveV2 = (secret: string, kid: string): Buffer => Buffer.from(hkdfSync("sha256", secret, kid, INFO, 32));
const deriveV1 = (secret: string): Buffer => createHash("sha256").update(secret).digest();

export function encryptSecret(value: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!value || value.startsWith("enc:")) return value;
  const current = keyring(env)[0]!;
  const kid = keyId(current);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveV2(current, kid), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${V2}${kid}:${Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url")}`;
}

function open(payload: Buffer, key: Buffer): string {
  if (payload.length <= 28) throw configError("A stored secret is corrupted");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]).toString("utf8");
}

/** Plaintext values pass through unchanged (secrets stored before encryption existed). */
export function decryptSecret(value: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!value || !value.startsWith("enc:")) return value;
  const ring = keyring(env);
  if (value.startsWith(V2)) {
    const rest = value.slice(V2.length);
    const sep = rest.indexOf(":");
    const kid = rest.slice(0, sep);
    const secret = ring.find((k) => keyId(k) === kid);
    if (sep < 0 || !secret) throw configError("A stored secret was encrypted with a key that is no longer configured");
    return open(Buffer.from(rest.slice(sep + 1), "base64url"), deriveV2(secret, kid));
  }
  if (value.startsWith(V1)) {
    const payload = Buffer.from(value.slice(V1.length), "base64url");
    for (const secret of ring) {
      try {
        return open(payload, deriveV1(secret));
      } catch {
        // wrong key for this value; try the next one
      }
    }
    throw configError("A stored secret could not be decrypted with any configured key");
  }
  throw configError("A stored secret has an unknown format");
}

/** True when the value is not yet encrypted with the current key (plaintext, v1, or an older key id). */
export function needsReencrypt(value: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!value) return false;
  return !value.startsWith(`${V2}${keyId(keyring(env)[0]!)}:`);
}
