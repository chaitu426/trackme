import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, keyId, keyring, needsReencrypt } from "./secret-box";

const K1 = "0123456789abcdef0123456789abcdef";
const K2 = "fedcba9876543210fedcba9876543210";
const env = (over: Record<string, string | undefined>) => ({ NODE_ENV: "test", ...over }) as unknown as NodeJS.ProcessEnv;

test("a value round-trips, is not plaintext, and names the key that encrypted it", () => {
  const e = env({ SITE_SIGNING_SECRET_KEY: K1 });
  const sealed = encryptSecret("hooks.slack.com/services/T/B/secret", e);
  assert.match(sealed, new RegExp(`^enc:v2:${keyId(K1)}:`));
  assert.ok(!sealed.includes("slack"));
  assert.equal(decryptSecret(sealed, e), "hooks.slack.com/services/T/B/secret");
  assert.notEqual(encryptSecret("same", e), encryptSecret("same", e)); // fresh nonce each time
});

test("rotation: values written under the old key still read after a new key becomes current", () => {
  const before = env({ SITE_SIGNING_SECRET_KEY: K1 });
  const sealedOld = encryptSecret("signing-secret", before);

  const during = env({ SITE_SIGNING_SECRET_KEY: K2, SITE_SIGNING_SECRET_KEY_PREVIOUS: K1 });
  assert.equal(decryptSecret(sealedOld, during), "signing-secret");
  assert.equal(needsReencrypt(sealedOld, during), true);
  const sealedNew = encryptSecret("signing-secret", during);
  assert.match(sealedNew, new RegExp(`^enc:v2:${keyId(K2)}:`));
  assert.equal(needsReencrypt(sealedNew, during), false);

  // after the old key is retired, old values fail loudly instead of returning garbage
  const after = env({ SITE_SIGNING_SECRET_KEY: K2 });
  assert.throws(() => decryptSecret(sealedOld, after), /no longer configured/);
  assert.equal(decryptSecret(sealedNew, after), "signing-secret");
});

test("values written by the previous format (v1) still decrypt, and are flagged for re-encryption", () => {
  const key = createHash("sha256").update(K1).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()]);
  const v1 = `enc:v1:${Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64url")}`;
  const e = env({ SITE_SIGNING_SECRET_KEY: K2, SITE_SIGNING_SECRET_KEY_PREVIOUS: K1 });
  assert.equal(decryptSecret(v1, e), "legacy-secret");
  assert.equal(needsReencrypt(v1, e), true);
  assert.equal(decryptSecret("plain-old-value", e), "plain-old-value");
  assert.equal(needsReencrypt("plain-old-value", e), true);
});

test("a tampered value does not decrypt", () => {
  const e = env({ SITE_SIGNING_SECRET_KEY: K1 });
  const sealed = encryptSecret("secret", e);
  const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
  assert.throws(() => decryptSecret(flipped, e));
});

test("production refuses a missing, short or public development key; development may use the documented one", () => {
  const dev = "dev-site-signing-secret-key-min-32-chars";
  assert.throws(() => keyring(env({ NODE_ENV: "production" })), /not set/);
  assert.throws(() => keyring(env({ NODE_ENV: "production", SITE_SIGNING_SECRET_KEY: dev })), /public development key/);
  assert.throws(() => keyring(env({ SITE_SIGNING_SECRET_KEY: "short" })), /at least 32/);
  assert.deepEqual(keyring(env({})), [dev]);
});
