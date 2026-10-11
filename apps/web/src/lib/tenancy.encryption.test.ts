import assert from "node:assert/strict";
import test from "node:test";

import { decryptSiteSigningSecret, encryptSiteSigningSecret } from "./tenancy";

test("encrypts site signing secrets before they are persisted", () => {
  process.env.SITE_SIGNING_SECRET_KEY = "0123456789abcdef0123456789abcdef";

  const secret = "gis_example_secret_value_123456";
  const encrypted = encryptSiteSigningSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.ok(encrypted.startsWith("enc:v1:"));
  assert.equal(decryptSiteSigningSecret(encrypted), secret);
});

test("decryptSiteSigningSecret leaves legacy plaintext values untouched", () => {
  process.env.SITE_SIGNING_SECRET_KEY = "0123456789abcdef0123456789abcdef";

  assert.equal(decryptSiteSigningSecret("legacy-plaintext-secret"), "legacy-plaintext-secret");
});
