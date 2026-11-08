import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./safe-redirect";
import { hashInviteToken, newInviteToken } from "./invite-token";
import { escapeHtml, oneLine } from "./email";
import { passwordProblem, isPwnedPassword } from "./password-policy";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { createHash, scryptSync, randomBytes } from "node:crypto";

test("redirects stay on this site", () => {
  assert.equal(safeNextPath("/acme/overview?range=7d#top"), "/acme/overview?range=7d#top");
  const BS = String.fromCharCode(92); // a backslash, built from its code so no escaping layer can change it
  const TAB = String.fromCharCode(9);
  const NL = String.fromCharCode(10);
  for (const bad of ["//evil.com", `/${BS}evil.com`, `/${BS}/evil.com`, "https://evil.com", "javascript:alert(1)", "evil.com", `/${TAB}/evil.com`, `/a${NL}b`, "", null, undefined]) {
    assert.equal(safeNextPath(bad as string), null, String(bad));
  }
});

test("an invite token is 256 random bits, and only its hash is meant to be stored", () => {
  const a = newInviteToken();
  const b = newInviteToken();
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashInviteToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
});

test("names cannot add markup or mail headers", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(oneLine("Acme\r\nBcc: victim@example.com"), "Acme Bcc: victim@example.com");
  assert.equal(oneLine("x".repeat(500)).length, 80);
});

test("password policy: length first, then common, repetitive and personal passwords", () => {
  assert.match(passwordProblem("short1!")!, /at least 12/);
  assert.match(passwordProblem("password123")!, /at least 12/);
  assert.match(passwordProblem("qwertyuiopas")!, /too common/);
  assert.match(passwordProblem("aaaaaaaaaaaaaa")!, /repetitive/);
  assert.match(passwordProblem("ada.lovelace-2026", { email: "ada.lovelace@example.com" })!, /email/);
  assert.equal(passwordProblem("correct horse battery staple"), null);
  assert.match(passwordProblem("x".repeat(200))!, /at most 128/);
});

test("the breach check sends only a 5-character hash prefix, and fails open", async () => {
  const sha1 = createHash("sha1").update("hunter2-hunter2").digest("hex").toUpperCase();
  let requested = "";
  const found = (async (url: string) => {
    requested = url;
    return new Response(`${sha1.slice(5)}:42\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0`);
  }) as unknown as typeof fetch;
  assert.equal(await isPwnedPassword("hunter2-hunter2", found), true);
  assert.equal(requested, `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
  assert.ok(!requested.includes(sha1.slice(5)));

  const absent = (async () => new Response("0000000000000000000000000000000000A:3")) as unknown as typeof fetch;
  assert.equal(await isPwnedPassword("hunter2-hunter2", absent), false);
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal(await isPwnedPassword("anything-at-all", down), false);
});

test("passwords: new hashes verify, carry their cost, and legacy hashes still verify and are flagged for upgrade", async () => {
  const hash = await hashPassword("a long enough passphrase");
  assert.match(hash, /^scrypt2:65536:8:2:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await verifyPassword("a long enough passphrase", hash), true);
  assert.equal(await verifyPassword("a long enough passphrasE", hash), false);
  assert.equal(needsRehash(hash), false);

  const salt = randomBytes(16).toString("hex");
  const legacy = `scrypt:${salt}:${scryptSync("old password", salt, 64).toString("hex")}`;
  assert.equal(await verifyPassword("old password", legacy), true);
  assert.equal(await verifyPassword("wrong", legacy), false);
  assert.equal(needsRehash(legacy), true);
});

test("a stored hash cannot ask the server for unbounded work", async () => {
  assert.equal(await verifyPassword("x", `scrypt2:${2 ** 30}:8:2:aa:bb`), false);
  assert.equal(await verifyPassword("x", "scrypt2:65536:8:2:aa"), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});
