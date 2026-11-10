# Security Audit: Findings Before Production

Date: 2026-11-08. Scope: the whole repository on branch `fet/tracer-doc-update` (web app, ingestion edge, ingest-proxy,
event worker, scheduled worker, tracker SDK, ClickHouse and Postgres schemas, infra files).

**How this was done, and its limits.** Static review: I read the code paths that handle authentication, authorization,
secrets, outbound requests, input rendering and the public ingestion endpoint, scanned every API route for its guard,
searched the repository and git history for committed secrets, and ran `pnpm audit --prod` against the lockfile.
**Nothing was exploited and no running system was tested.** Each finding states whether it is confirmed from the code or
from the advisory database. This is not a penetration test, and the absence of a finding is not a clean bill of health
(not covered: infrastructure configuration outside this repo, TLS, network policy, cloud IAM, the managed Kafka,
Postgres, Redis and ClickHouse services, email deliverability settings, and the CI/CD pipeline's secrets handling).

Severity: **Critical** = remote takeover of accounts, servers or other customers' data with low effort. **High** =
serious compromise requiring a precondition any customer can meet. **Medium** = needs another weakness or is limited in
reach. **Low** = hardening.

---

## Summary

| # | Sev | Finding | Reach |
|---|---|---|---|
| C1 | **Critical** | Any user can take over any existing account through the invite flow | Every account on the platform |
| C2 | **Critical** | Next.js unauthenticated remote code execution (Image Optimization) in the installed version | The web server, its secrets and databases |
| H1 | High | Login does not require a verified email; signup lets anyone set the password of an unverified account | Pre-hijacking of any not-yet-registered email |
| H2 | High | The "2FA" step is not a second factor | Every account that relies on it |
| H3 | High | SSRF through alert webhooks, with the response body returned to the caller | Cloud metadata, internal services |
| H4 | High | No security headers (CSP, HSTS, frame protections, nosniff, referrer policy) | Whole web app |
| H5 | High | A site's public key is enough to burn its quota and poison its data; the Origin check is forgeable | Every customer site |
| H6 | High | Unescaped HTML in outgoing email, sendable to any address | Phishing from your domain |
| H7 | High | 16 known dependency advisories (1 critical, 7 high), including SQL injection in the ORM | See C2 and the table below |
| H8 | High | The login OTP is still written to the logs in production | Anyone with log access |
| M1 | Medium | OTP attempt limit can be raced | Brute force of 6-digit codes |
| M2 | Medium | The tracker is served from the dashboard origin, mutable, with no integrity pin | Every customer's website visitors |
| M3 | Medium | Secrets at rest: no key rotation, silent public dev-key fallback, webhook secrets in plaintext | Database leak impact |
| M4 | Medium | Password hashing cost is below current guidance; weak password policy | Offline cracking after a leak |
| M5 | Medium | Account enumeration | Targeted attacks |
| M6 | Medium | Unauthenticated public dashboard endpoint does an unindexed scan per request | Denial of service |
| M7 | Medium | Open redirect after login (`/\host`) | Phishing |
| M8 | Medium | Lockout is keyed by email only | Denial of service on any user |
| M9 | Medium | Session cookie can be shared across subdomains | Trust boundary |
| M10 | Medium | Almost no rate limiting outside the auth routes; API keys are unmetered | Abuse, cost |
| L1-L5 | Low | Hardening items | See below |

---

## Critical

### C1. Account takeover of any existing user through invites (confirmed from the code)

**Exploit, using only a free account:**
1. Sign up and create a workspace. You are its owner.
2. `POST /api/v1/workspaces/{id}/members` with `victim@company.com`. The response includes the invite `token`
   (`members/route.ts`, line 60 of the handler; the pending-invite list also returns `token`).
3. `POST /api/v1/invites/accept` with that token. Because a user with that email already exists, the route adds them to
   your workspace **and creates a 30-day session for the existing account, setting it as the response cookie**
   (`invites/accept/route.ts`: `createRegisteredSession({ userId })` then `response.cookies.set(SESSION_COOKIE, ...)`).
   No password, no code, no logged-in caller, no interaction from the victim.

You are now logged in as the victim, with their workspaces, sites, API keys, alert channels and member lists.

**Why it exists.** The code treats "holds the invite token" as proof of owning the invited mailbox. That is only true
if the token travels exclusively through that mailbox, but the same token is returned to the inviter (and, via
`GET /members` which needs only `read:analytics`, to any member including a viewer). The `emailVerified: true` it sets for
newly created users has the same flaw, and it lets an attacker create a *verified* account on someone else's email.

**Fix.**
- Never return an invite token in any API response or UI. The token exists only in the email.
- Accepting an invite for an **existing** account must require that the caller is already logged in as that account
  (session email equals the invite email). Never mint a session from a token alone.
- For a **new** account, create it unverified and verify the email with an OTP before issuing a session (the signup
  verification flow already exists).
- Make invite tokens single-use, short-lived, and bound to the email; hash them at rest; rate-limit invite creation per
  workspace and per inviter.
- Remove the "copy invite link" feature, or turn it into a link that still requires OTP verification of the invited
  address.
- After fixing, invalidate all pending invites and review audit logs for `invite.accepted` where the actor's session
  was minted by the token (look for the same IP creating and accepting an invite).

### C2. Next.js unauthenticated RCE in the Image Optimization API (from `pnpm audit`)

Installed `next` is **15.5.25**; the advisory covers `>=10.0.0 <=15.5.27` and is fixed in **15.5.28**. The app configures
`images.remotePatterns` (flagcdn.com and cdn.jsdelivr.net), so the optimizer is enabled. The same audit lists, for
`next` in the same range: a high-severity denial of service in App Router Server Actions (fixed 15.5.28) and two
moderate cache-poisoning issues in SSG/ISR (fixed 15.5.27). `packages/landing` also depends on `next ^15.2.1`.

**Fix.** Upgrade `next` to at least 15.5.28 (or the latest 15.x patch) in `apps/web`, `apps/tracker-docs` and
`packages/landing`, then redeploy. As a stopgap before the upgrade, block `/_next/image` at the edge/WAF or remove
`images.remotePatterns`. `cdn.jsdelivr.net` also lets the optimizer fetch arbitrary files from any npm package or
GitHub repo; narrow the pattern to the exact path you use.

---

## High

### H1. Unverified accounts are fully usable; signup overwrites their password (confirmed)

- `login/route.ts` never checks `emailVerified`.
- `signup/route.ts`, for an existing **unverified** account, replaces the name and password hash with whatever the
  caller sends and re-sends the verification code.

**Exploit (pre-hijacking).** An attacker signs up with `victim@company.com` and a password they know. The account stays
unverified, but the attacker can log in with it immediately. If the victim later signs up, verifies, or is invited, the
attacker already holds a working login to that identity. Invitations for the victim's email would also attach to the
attacker's session.

**Fix.** Block login until the email is verified. Do not accept a new password for an existing account at signup; store
the chosen password as pending and apply it only after the OTP is verified, and send the OTP only to the address
being claimed. Return the same response whether or not the address is registered (see M5).

### H2. The "2FA" is not a second factor (confirmed)

- `POST /auth/otp/send` with `purpose: "login_otp"` and `POST /auth/otp/verify` issue a full session from **email and
  code alone**, for any existing user, whether or not they have 2FA enabled and whether or not the password was ever
  entered. The password step and the OTP step are not linked by any challenge token.
- Therefore the strength of every account equals the strength of its mailbox, the password adds nothing, and enabling
  "2FA" (`totpEnabled`) does not require both. `totpEnabled` triggers an emailed code, not TOTP.
- `requireOtp` is a client-supplied field in the login body.

**Fix.** Decide on one model and implement it honestly. If OTP is a second factor: after a correct password, return a
short-lived single-use challenge id; the OTP verify step must present that id and the session is issued only then.
Remove passwordless `login_otp` for accounts with 2FA. If you want authenticator-app 2FA, implement real TOTP (RFC 6238)
with recovery codes and store the secret encrypted.

### H3. SSRF through alert channels, with the response body returned (confirmed)

`alert-channels` accepts any URL (`z.string().url()`) for Slack, Discord and generic webhooks. `lib/alerts.ts` calls
`fetch(url)` with default redirect following and **no timeout**, and on any non-2xx response returns
`"Webhook responded {status}: {body}"` to the caller (the `test` route returns it as `error`). Any user can create a
workspace and is its admin, so this is available to anyone.

**Impact.** Requests to `http://169.254.169.254/` (cloud metadata and its credentials), `localhost`, the Redis, Postgres,
ClickHouse and Kafka addresses, and the internal metrics ports; error bodies from internal services are read back; port
scanning by timing; redirects from an attacker host to internal targets; hung connections with no timeout.

**Fix.** Resolve the hostname yourself, reject loopback, link-local, private (RFC 1918, ULA) and metadata ranges
before **and after** following redirects (or disable redirects), connect to the validated IP to defeat DNS rebinding,
allow only `https`, require Slack/Discord URLs to match `hooks.slack.com` / `discord.com`, set a 5 s timeout and a
response size cap, and never return the remote body (return only "failed with status N"). Run outbound webhooks from a
network segment with no route to internal services.

### H4. No security headers (confirmed)

`next.config.ts` `headers()` only sets caching for the tracker. There is no `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or
`Permissions-Policy`. Consequences: the dashboard can be framed (clickjacking on destructive actions), any XSS has no
second line of defence, and HTTPS downgrade protection is absent.

**Fix.** Add them for all routes except the tracker asset: CSP with `default-src 'self'`, nonce-based scripts, and
`frame-ancestors 'none'`; HSTS (`max-age=63072000; includeSubDomains`); `nosniff`; `Referrer-Policy:
strict-origin-when-cross-origin`; a restrictive `Permissions-Policy`. The public `/share/*` pages should be allowed to be
framed only if you intend embedding.

### H5. A public site key is enough to exhaust a customer's quota and poison their data

Site keys are public by design (they ship in page HTML). The edge's controls are weaker than they look:
- The **Origin/Referer match is a header any non-browser client sets freely**, so it is not an access control.
- The **event URL host must match the site's domain**, but the URL is attacker-supplied and trivially set to it.
- HMAC signing is optional, and when used the secret sits in client JavaScript unless a first-party proxy is used;
  signatures carry **no timestamp or nonce**, so a captured request can be replayed (the dedupe window is now 5 minutes).

**Attack.** Anyone who views a competitor's page source can send up to the per-site rate (about 8,000 events/s with
the Redis gate's default of 10,000 requests/minute of 50 events, 2,000 events/s with leased admission) with fake events:
a typical 10-million-event monthly quota is gone in one to two hours (the customer is then blocked with 402), their
dashboards fill with junk, and their usage metering inflates.

**Fix.** Make the quota an *attributable* resource: require signed requests (via a first-party proxy) for any site on a
paid plan; add a timestamp to the signed payload and reject skew over 5 minutes; add per-site anomaly detection and an
automatic "spike" hold that stops billing and alerts the owner; cap overage billing; add per-site IP-diversity
checks (a single IP sending most of a site's volume is not traffic). Document that Origin checking is advisory.

### H6. HTML injection in outgoing email

`lib/email.ts` interpolates `workspaceName` and `inviterName` into HTML with no escaping (`<h1>You're invited to join
${workspaceName}</h1>` and the avatar, button, and preview text). A workspace can be named
`<a href="https://evil">Verify your account</a>`, and the invite endpoint will mail it to any address, from your
domain and sender reputation. There is no per-workspace or per-user limit on invites.

**Fix.** HTML-escape every interpolated value (or use a templating engine that escapes by default), validate names to a
conservative character set, add per-inviter and per-workspace invite rate limits and a cap on pending invites, require
the inviter's email to be verified, and put the invited address behind a confirmation step.

### H7. Dependency advisories (from `pnpm audit --prod`, run during this audit)

16 advisories: 1 critical, 7 high, 8 moderate. The ones that matter most:

| Package | Installed range | Severity | Issue | Fix |
|---|---|---|---|---|
| `next` | 15.5.25 | Critical / High / Moderate | RCE in image optimizer, Server Actions DoS, cache poisoning | >= 15.5.28 |
| `drizzle-orm` | ^0.39.3 | High | SQL injection through improperly escaped SQL identifiers | >= 0.45.2 |
| `zod` | ^3.24.2 | High | Memory exhaustion validating oversized constrained collections | >= 4.6.6 (major bump) |
| `nodemailer` | ^10.0.14 | Moderate (x2) | Address parser mishandles comments and quoted strings (recipient confusion) | >= 10.1.4 |
| `postcss`, `source-map-js`, `sharp`, `uuid` | transitive | High / Moderate | Mostly build-time or image processing | per advisory |

The drizzle issue is exploitable only where an identifier (table or column name) comes from user input. A search found
the application builds SQL with parameterised `sql` templates, so I did not find an exploitable path, but upgrade
anyway. The nodemailer issues matter because invite and OTP mail takes user-controlled addresses.

**Fix.** Upgrade, run the test suite, and add `pnpm audit --prod --audit-level=high` as a failing CI step plus
Dependabot or Renovate. (I did not check whether CI already runs an audit.)

### H8. Login OTP still logged (confirmed)

`auth/login/route.ts` line 94: `console.log("[AUTH 2FA] Login OTP generated for ${email}: [ ${code} ]")` runs in every
environment. Earlier in this project I gated the same log in `otp/send`; this one was missed. Anyone with log access
(log aggregator, support staff, a leaked log bucket) can take over accounts that use the OTP login.

**Fix.** Delete it. Also search every log statement for secrets and tokens as part of review.

---

## Medium

- **M1. OTP attempt counter race.** `verifyOtp` reads `attempts`, compares, then writes `attempts + 1`. Parallel requests
  all read `0`, so the 5-attempt limit can be exceeded by sending many requests at once; a 6-digit code has a one in a
  million chance per guess. The send limiter (`checkSendRateLimit`) uses the non-atomic INCR/EXPIRE pattern fixed
  elsewhere. **Fix:** increment atomically *before* comparing (`UPDATE ... SET attempts = attempts + 1 WHERE attempts < 5
  RETURNING`), and use the atomic limiter.
- **M2. Tracker supply chain.** The script customers load on every page is served from the dashboard's own origin when
  no CDN is configured, at mutable paths (`/tracker.js` = latest, `/t/v1/tracker.js`), and **the install snippets in the
  docs have no `integrity=` attribute** (zero occurrences). A compromise of the dashboard deploy or of that path is
  arbitrary JavaScript on every customer's site (form data, credentials, payment pages). **Fix:** serve from a separate
  cookieless domain, publish immutable versioned files with content hashes, put `integrity` + `crossorigin` in the docs,
  sign releases, and protect the publish step.
- **M3. Secrets at rest.** Site signing secrets are AES-256-GCM encrypted with `sha256(env)` as the key: no KDF, no key id,
  no rotation path (changing the key makes every stored secret undecryptable). `tenancy-secrets.ts` falls back to the
  **public development key** when the variable is unset, and the Go resolver falls back to it when the key is under 32
  characters. Alert-channel webhook URLs (a bearer secret for Slack/Discord) and webhook signing secrets are stored in
  plaintext JSON. **Fix:** envelope encryption with a key id and rotation, fail closed when the key is missing, encrypt
  channel config, and keep keys in a KMS.
- **M4. Passwords.** scrypt uses Node's default `N=16384`, below current guidance (2^17); minimum length 8 with one digit
  or symbol; no breached-password check; no maximum-cost protection. scrypt runs on the libuv thread pool, so a login
  flood from many IPs can starve other async work. **Fix:** raise the cost (or Argon2id), minimum 12 characters,
  breached-password check, a bounded queue for hashing.
- **M5. Enumeration.** `signup` returns 409 `EMAIL_IN_USE` for verified accounts; `invites/accept` returns different
  results for existing and new emails; and **login answers differently**: a wrong password for an existing account says
  "Invalid email or password. N attempts remaining", while an unknown email gets the generic message without a count.
  (The response-time gap was closed by hashing a dummy password.) **Fix:** make signup, login and invite responses
  identical for existing and unknown addresses, and tell real users by email.
- **M6. Public dashboard endpoint.** `getPublicSite` filters `sites.settings->>'publicDashboardSlug' = $1` with no index
  and no rate limit, on an unauthenticated page: each request scans the sites table. The slug has 48 bits of entropy,
  which is adequate against guessing. **Fix:** a column with a unique index and a rate limit.
- **M7. Open redirect.** `safeNextPath` accepts `/\evil.com` (starts with `/`, not `//`); browsers treat `\` as `/`, so the
  post-login navigation can leave the site. **Fix:** parse with `new URL(next, origin)` and require the same origin and a
  path that does not contain a backslash.
- **M8. Lockout denial of service.** Five requests with a known email lock that account for 15 minutes from anywhere.
  **Fix:** key the lockout by email and IP, with a separate higher threshold per email, and unlock via email OTP.
- **M9. Cookie scope.** `SESSION_COOKIE_DOMAIN` can share the session cookie with a parent domain so a docs subdomain
  can read it. Every sibling subdomain then becomes part of the session's trust boundary (an XSS or takeover on any one
  of them acts as the user). **Fix:** keep the cookie host-only; use a separate token for the docs site if needed.
- **M10. Rate limiting.** Only the auth routes are limited. Invite creation, alert-channel tests, segment previews,
  people search, API-key creation and the analytics endpoints have no per-user or per-key limit; API keys have no
  `lastUsedAt` or usage metering, and an `admin:workspace` key can do everything a human admin can.

## Low and hardening

- **L1.** The Go edge defaults `TRUSTED_PROXY_HOPS` to 1; if exposed directly, `X-Forwarded-For` is client-controlled.
  `/metrics` is served on the public port unless `METRICS_PORT` is set. The development compose file publishes
  Postgres, Redis, ClickHouse and Kafka on all interfaces with development passwords and plaintext Kafka.
- **L2.** Signed ingestion requests can be replayed after the 5-minute dedupe window (see H5).
- **L3.** Defence in depth: some ClickHouse queries filter by `site_id` only, not `workspace_id`; this is safe while every
  route verifies the site belongs to the caller's workspace, which they currently do.
- **L4.** No account deletion or data export for dashboard users; backups are outside the erasure path.
- **L5.** No `security.txt` or disclosure process; no evidence in the repo of secret scanning, SAST, or dependency
  scanning in CI.

---

## What was checked and found sound

- **No secrets in the repository or its history**: only `.env.example` and `infra/aiven/.env.aiven.example` are tracked, and a
  pattern scan for private keys and common token formats found nothing.
- **Authorization on resource routes**: every `/api/v1` route except invite acceptance has a guard, and nested lookups
  (`site` in `workspace`, `channel`, `invite`, `member`, `api key`, `goal`, `funnel`, `segment`) are scoped to the
  authorized parent in their `WHERE` clause. (The exception, `POST /people`, is fixed.)
- **Constant-time comparisons** for HMAC signatures (edge), OTP hashes, API key hashes and the metrics token.
- **OTP generation** uses `crypto.randomInt`; codes are stored as HMACs; sessions are server-tracked, revocable and
  checked against `sessions_valid_after`.
- **Cookie flags** are `HttpOnly`, `SameSite=Lax`, `Secure` in production; error responses do not leak stack traces.
- **Host matching** at the edge requires a dot boundary (`evilexample.com` does not match `example.com`).
- **SQL**: Drizzle queries use bound parameters; ClickHouse queries bind values (retention builds a `DELETE` string but
  validates ids as UUIDs).

## Recommended order

1. **This week, before any further user growth:** C1, C2, H8, then H1 and H2. These allow takeover or remote compromise
   with little effort.
2. **Next:** H3 (SSRF), H4 (headers), H6 (email), H7 (dependencies and the CI audit gate), M1.
3. **Then:** H5 (quota and poisoning controls), M2 (tracker integrity), M3 (secrets rotation), M4.
4. **Hardening:** the rest, plus an external penetration test of the fixed system and a bug-bounty or disclosure policy.

Rotate after fixing C1/C2/H8: `NEXTAUTH_SECRET` (invalidates all sessions), `SITE_SIGNING_SECRET_KEY` (needs a re-encrypt
step first), any database or third-party credentials reachable from the web server, and review the audit log and access
logs for abuse of the invite and webhook endpoints.
