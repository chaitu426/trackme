import assert from "node:assert/strict";
import test from "node:test";
import { signSessionToken, verifySessionToken } from "./session";

const secret = "test-session-hmac-secret";

test("new tokens carry iat and survive verification", async () => {
  const token = await signSessionToken({ userId: "u1", email: "a@b.c" }, secret, 60);
  const payload = await verifySessionToken(token, secret);
  assert.ok(payload);
  assert.equal(payload.userId, "u1");
  assert.ok(payload.iat > 0);
  assert.ok(payload.exp > payload.iat);
});

test("legacy tokens without iat are treated as issued at epoch", async () => {
  const { createHmac } = await import("node:crypto");
  const body = Buffer.from(JSON.stringify({ userId: "u1", email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 60 }))
    .toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  const payload = await verifySessionToken(`${body}.${signature}`, secret);
  assert.ok(payload);
  assert.equal(payload.iat, 0);
});
