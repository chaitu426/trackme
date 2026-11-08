import { test } from "node:test";
import assert from "node:assert/strict";
import { check, PUBLIC_ROUTES } from "./security-guard.mjs";

const rulesHit = (path, text) => check([{ path, text }]).map((v) => v.rule);
const route = (name, body) => [`apps/web/src/app/api/${name}/route.ts`, body];

test("trusting X-Forwarded-For directly is flagged, except in the helper that does it correctly", () => {
  assert.deepEqual(rulesHit("apps/web/src/lib/other.ts", 'const ip = request.headers.get("x-forwarded-for");'), ["client-ip"]);
  assert.deepEqual(rulesHit("apps/web/src/lib/client-ip.ts", 'request.headers.get("x-forwarded-for")'), []);
});

test("logging a code, token, secret or password is flagged", () => {
  for (const line of [
    "console.log(`OTP for ${email}: ${code}`);",
    "console.warn(`token=${token}`);",
    "console.log(`[AUTH 2FA] Login OTP generated for ${email}: [ ${code} ]`);",
    "console.error(`secret: ${secret}`);",
  ]) {
    assert.deepEqual(rulesHit("apps/web/src/lib/x.ts", line), ["no-secrets-in-logs"], line);
  }
  assert.deepEqual(rulesHit("apps/web/src/lib/x.ts", "console.log(`sent to ${email}`);"), []);
  assert.deepEqual(rulesHit("apps/web/src/lib/x.ts", "console.log(`[dev] code ${code}`); // security-guard: allow development only, gated by NODE_ENV"), []);
});

test("an API route with no authorization call fails, unless it is a listed public route", () => {
  const [path, body] = route("v1/anything", "export async function GET() { return Response.json({}); }");
  assert.deepEqual(rulesHit(path, body), ["route-needs-authorization"]);
  const [okPath, okBody] = route("v1/anything", "await authenticateRequest(request, id);");
  assert.deepEqual(rulesHit(okPath, okBody), []);
  const [pubPath, pubBody] = route("auth/login", "export async function POST() {}");
  assert.deepEqual(rulesHit(pubPath, pubBody), []);
  assert.ok(PUBLIC_ROUTES.has("v1/invites/accept"));
});

test("fetching a variable URL on the server is flagged; client code and literal URLs are not", () => {
  assert.deepEqual(rulesHit("apps/web/src/lib/alerts.ts", "const res = await fetch(webhookUrl, { method: 'POST' });"), ["outbound-requests-use-safe-fetch"]);
  assert.deepEqual(rulesHit("apps/web/src/lib/x.ts", "await fetch(`https://api.pwnedpasswords.com/range/${p}`);"), []);
  assert.deepEqual(rulesHit("apps/web/src/components/a.tsx", "fetch(url)"), []);
  assert.deepEqual(rulesHit("apps/web/src/lib/safe-fetch.ts", "fetch(url)"), []);
});

test("raw HTML, dynamic code, and disabled TLS verification are flagged", () => {
  assert.deepEqual(rulesHit("apps/web/src/components/x.tsx", "<div dangerouslySetInnerHTML={{ __html: h }} />"), ["no-raw-html"]);
  assert.deepEqual(rulesHit("apps/tracker-docs/src/components/code-block.tsx", "<div dangerouslySetInnerHTML={{ __html: h }} />"), []);
  assert.deepEqual(rulesHit("apps/web/src/lib/x.ts", "const v = eval(input);"), ["no-dynamic-code"]);
  assert.deepEqual(rulesHit("apps/web/src/lib/x.ts", "redis.eval(script, 1, key)"), []);
  assert.deepEqual(rulesHit("services/ingestion-go/x.go", "tls.Config{InsecureSkipVerify: true}"), ["no-tls-verification-off"]);
});

test("the invite token column may be read only by the accept route", () => {
  assert.deepEqual(rulesHit("apps/web/src/app/x/page.tsx", "token: workspaceInvites.token,"), ["invite-token-never-selected"]);
  assert.deepEqual(rulesHit("apps/web/src/app/api/v1/invites/accept/route.ts", "eq(workspaceInvites.token, h)"), []);
});

test("weak randomness is flagged where secrets are made", () => {
  assert.deepEqual(rulesHit("apps/web/src/lib/otp.ts", "const n = Math.floor(Math.random() * 1e6);"), ["no-weak-randomness-for-secrets"]);
  assert.deepEqual(rulesHit("apps/web/src/components/chart.tsx", "Math.random()"), []);
});

test("committed secrets are flagged", () => {
  const key = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
  assert.deepEqual(rulesHit("config/x.txt", key), ["no-committed-secrets"]);
  assert.deepEqual(rulesHit("config/x.txt", "AKIA" + "ABCDEFGHIJKLMNOP"), ["no-committed-secrets"]);
  assert.deepEqual(rulesHit("config/x.txt", "nothing to see"), []);
});
