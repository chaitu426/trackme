# Beta 0.2: Teams and Collaboration Suite (plan for review, no code yet)

Status: draft for review. Current release: **beta 0.1**. This plan is the scope of **beta 0.2** (decided).
Naming: the UI and API keep **workspace** (no rename). A new tier, **company**, sits above it.

Goal: turn TrackMe from an analytics app into a workspace where marketing, engineering, QA and finance each
see the features they need, own the issues that concern them, and talk about them in one place.

---

## 1. Where we are today (audit of beta 0.1)

What works:
- Four roles (`owner`, `admin`, `member`, `viewer`) in `workspace_members`, composite PK `(workspace_id, user_id)`.
- Tenant isolation on every route (`assertWorkspaceMatch`), 30 s membership cache with explicit invalidation.
- Invites: hashed token, 7-day expiry, rate limited, atomically claimed, cannot hijack an existing account.
- Owner rules: cannot leave, cannot change own role, only an owner can transfer ownership.
- Audit log rows for invites, role changes, removals and API-key creation.

Gaps that this release must close first (Phase 0):

| # | Gap | Where | Fix |
|---|---|---|---|
| G1 | The permission matrix is not what is enforced. `sites:delete`, `workspace:billing`, `goals:manage`, `exports:create` are never checked; most admin routes use the alias `admin:workspace` (= `workspace:manage`) | `packages/authz/src/permissions.ts`, every `authenticateRequest(..., "admin:workspace")` | One permission vocabulary; each route names the real permission; delete the alias |
| G2 | No rank rule: an admin can demote or remove another admin | `members/[memberId]/route.ts` | Actor rank must be strictly higher than the target's current and new role (owner exempt) |
| G3 | API key with `admin:workspace` acts as admin (invite, change roles, remove members). Its id `api-key:<id>` is written into uuid columns (`invited_by`, `audit_logs.actor_id`), which is likely to error. Keys do not record their creator | `tenancy.ts`, `api-keys/route.ts` | API keys never manage members; add `created_by` to `api_keys`; audit actor type (`user` / `api_key`) |
| G4 | Ownership transfer is two separate updates, not a transaction | `members/[memberId]/route.ts` | Single transaction; assert exactly one owner afterwards |
| G5 | Any viewer can list every member's email; invite revoke deletes the row while re-send marks it `revoked` | `members/route.ts`, `invites/[inviteId]/route.ts` | Members list needs `members:read`; revoke sets `status = revoked` |
| G6 | No access control below the workspace: every member sees every site, payments and personal data | whole app | Phases 2 and 3 |

(G3's database error is expected from reading the code, not reproduced. Confirm with a test before fixing.)

---

## 2. Target model

```
Company            founder = owner(s). Plan, billing, creates workspaces, assigns workspace admins
 └─ Workspace      (today's workspace) workspace admin(s), members, sites
     ├─ Sites      many per workspace
     ├─ Teams      Marketing, Engineering, QA, Finance, Support, ...
     └─ Members    belong to the workspace, then join teams and/or get site access
```

### 2.1 Who can do what

| Scope | Roles | Notes |
|---|---|---|
| Company | `company_owner` (one or more, at least one always), `billing_admin` | Owners can create workspaces and assign each workspace's admin. Owners get implicit admin rights in every workspace of the company |
| Workspace | `owner`/`admin` (kept as today), `member`, `viewer`, plus `security_auditor` (audit log only) | A workspace admin sees only their workspace. Cross-workspace access is the same tenant-isolation check, applied at company level |
| Site | granted through teams or directly: `site_admin`, `analyst`, `developer`, `viewer` | Union of all grants, highest wins (PostHog and Amplitude behave the same way) |

### 2.2 Effective access rule

```
effective(user, site, feature) = max(
  workspace role grants,            // admin => everything in the workspace
  team grants for teams user is in, // site_team_features
  direct grants to the user         // site_user_features (overrides, optional)
)
```

Deny-by-default for any workspace `member` with no team and no direct grant: they see the workspace list and
nothing else. Existing members are migrated with an "All features" grant so nothing disappears on upgrade.

### 2.3 Features (modules) a grant can target

| Key | Pages / API | Typical team |
|---|---|---|
| `acquisition` | acquisition, pages, geography, realtime | Marketing |
| `funnels` | funnels, retention, journeys, goals | Marketing, Product |
| `errors` | errors, error groups | Engineering, QA |
| `releases` | releases, deploy impact, web vitals | Engineering |
| `payments` | payments, refunds, failures, leaks | Finance, Product |
| `people` | people list and segments (masked) | Support, Product |
| `people_pii` | unmask personal data in people / User 360 | Support leads only |
| `alerts` | alert rules and channels | Engineering |
| `issues` | issue board (Phase 4) | Engineering, QA |
| `ask` | Ask agent | any |
| `site_settings` | site settings, keys | Site admin |

Level per grant: `view` or `manage`. `manage` implies `view`.

### 2.4 Permission vocabulary (single source: `packages/authz`)

```
company:manage  company:billing  workspace:create
workspace:manage  workspace:members  members:read  audit:read
sites:create  sites:update  sites:delete
site:<feature>:view   site:<feature>:manage       (generated from the feature list)
data:erase  exports:create  api_keys:manage
```

`hasPermission(ctx, permission, { siteId? })` resolves workspace role first, then site grants. Routes call it
with the real permission; no aliases.

---

## 3. Data model (Postgres, Drizzle migrations)

New tables:

| Table | Key columns | Purpose |
|---|---|---|
| `companies` | id, name, plan, stripe ids (moved from `workspaces`), created_at | Billing and ownership tier |
| `company_members` | (company_id, user_id), role (`owner`/`billing_admin`) | Founders and billing contacts |
| `teams` | id, workspace_id, name, slug, description, lead_user_id, created_at; unique (workspace_id, slug) | A team inside a workspace |
| `team_members` | (team_id, user_id), role (`lead`/`member`), added_by | Membership |
| `site_team_features` | (site_id, team_id, feature), level (`view`/`manage`) | The core grant |
| `site_user_features` | (site_id, user_id, feature), level, expires_at nullable | Per-person override and expiring guest access |
| `custom_roles` (later) | id, workspace_id, name, permissions[] | Cloned from a built-in role, optional |

Changed tables:
- `workspaces` gains `company_id` (not null after backfill).
- `api_keys` gains `created_by`, and a `site_ids` allow-list (null = whole workspace).
- `audit_logs` gains `actor_type` (`user` / `api_key` / `system`) and `actor_ref` (text), so api-key actors stop breaking the uuid column. Keep `actor_id` for users.
- `workspace_invites` gains optional `team_ids` (jsonb), so an invite can place the person in teams on acceptance.

Backfill (one migration, reversible with a `.down.sql`):
1. For every workspace, create a company named after it; make the current workspace `owner` the company owner.
2. For every existing `member` and `viewer`, insert `site_user_features` rows granting all features on all sites
   at `manage` (member) or `view` (viewer). Behaviour is unchanged until an admin narrows access.
3. Create no teams automatically.

Indexes: `team_members(user_id)`, `site_team_features(team_id)`, `site_user_features(user_id)`.
Cache: extend `authz-cache.ts` to cache the resolved grant set per `(user, workspace)` for 30 s, invalidated on
any change to teams, grants or memberships.

---

## 4. API (all under existing `/api/v1`)

Phase 0 corrections apply to existing routes. New routes:

```
POST   /companies                                   create company + first workspace (onboarding)
GET    /companies/:id/workspaces
POST   /companies/:id/workspaces                    company owner only
PUT    /companies/:id/workspaces/:wid/admins        assign / remove a workspace admin

GET/POST        /workspaces/:wid/teams
PATCH/DELETE    /workspaces/:wid/teams/:tid
PUT/DELETE      /workspaces/:wid/teams/:tid/members/:uid

GET    /sites/:sid/access                           who has what, and why (effective-access view)
PUT    /sites/:sid/access/teams/:tid                set feature grants for a team
PUT    /sites/:sid/access/users/:uid                direct grant or guest (optional expiry)
GET    /me/access?workspace=:wid                    resolved grants for the sidebar
```

Every route resolves permissions through the new `hasPermission`, takes `workspaceId` from the authorised
resource (never from client input), and writes an audit row. Per-site analytics routes call
`requireSiteAccess(request, siteId, feature, level)`; today's `authorizeSite` / `requireMetricsAccess` become
thin wrappers around it.

---

## 5. UI

Keep today's naming. Changes:
- **Sidebar** built from `/me/access`: a feature is shown only if the user has at least `view`.
- **Workspace settings, People tab:** members, teams, invites. Invite dialog adds "Add to teams".
- **Workspace settings, Teams tab:** create team, set lead, add members.
- **Site settings, Access tab:** matrix of teams (rows) by features (columns) with None / View / Manage, plus direct
  grants and guests with expiry. A preview "View as team" shows the resulting sidebar.
- **Effective access panel:** pick a person, see each feature, the level, and which grant provides it.
- **Company page** (visible to company owners): workspaces list, create workspace, assign admin, billing.
- **Audit log page** with filters and CSV export (data already recorded).
- Pages a user cannot open return a clear "ask your workspace admin for access to Errors" screen, not a bare 403.

---

## 6. Collaboration features

### 6.1 Issues around errors (Phase 4, ships in 0.2)
- Assign an error group to a team or a person. Ownership rules per site, in the style of Sentry: match on URL path,
  error type or release; first matching rule assigns. Rules are optional and evaluated by the existing error worker
  at group creation, not on the request path.
- Status workflow: `new -> triaged -> in_progress -> fixed (in release X) -> verified -> closed`; a `fixed` issue
  reopens automatically if the same fingerprint appears in a later release (uses the existing releases data).
- Comments with `@mentions`, edit/delete own comment, attachments deferred.
- Watch / unwatch an issue.
- Tables: `issues` (1:1 with error group, owner_team_id, owner_user_id, status, fixed_in_release), `issue_comments`,
  `issue_watchers`.

### 6.2 Notifications
- In-app inbox (mentions, assignments, status changes, alerts for teams you own).
- Per-user preferences per channel. Delivery through existing `alert_channels` (email, Slack, webhook).
- Weekly digest per team (marketing numbers, engineering errors), scheduled in `scheduled-worker`.

### 6.3 Shared context
- Annotations on charts (deploys, campaigns, incidents).
- Saved views and shared reports, shareable to a team.

### 6.4 Chat (stretch for 0.2; otherwise 0.3)
- Channels per workspace, site and team; threads; share an error, chart or release into a message.
- Needs realtime delivery (SSE over the existing Redis), message store, retention and moderation. Do not start until
  6.1 and 6.2 are in use. If it does not fit, it moves to beta 0.3 without blocking the release.

---

## 7. Phases and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Fix G1 to G5; single permission vocabulary | Every route uses a named permission; rank and API-key tests pass; no use of `admin:workspace` remains |
| 1 | Company tier, workspace creation and admin assignment, backfill migration | Existing data migrates with no behaviour change; a second workspace under one company can be created and has an isolated admin |
| 2 | Teams, team members, site grants, effective-access API and screens | An admin can give Marketing only acquisition and funnels on one site and verify it with "View as team" |
| 3 | Feature enforcement in sidebar and every per-site API route; masked personal data | A Marketing member gets 403 from the errors and payments APIs, not just a hidden link |
| 4 | Issues, ownership rules, comments, mentions, notifications | An error is auto-assigned to Engineering, commented on, marked fixed in a release, and reopens on regression |
| 5 | Audit log screen, guests with expiry, custom roles, annotations, saved views | Audit export works; a guest loses access on the expiry date |
| 6 (stretch) | Chat | Only if 0 to 5 are done and stable |

Each phase is independently shippable behind no feature flag: unfinished pages are not linked until they work
(project rule: no feature flags).

---

## 8. Testing and quality gates

- **Authorization matrix test:** table-driven, role x feature x level x route, generated from the permission list.
  Fails if a route has no declared permission.
- **Isolation tests:** company A admin cannot read or write company B; workspace admin cannot see sibling workspaces;
  site grant on site 1 never applies to site 2.
- **Rank tests:** admin cannot demote or remove admin or owner; owner transfer leaves exactly one owner.
- **API key tests:** key cannot manage members; key limited by `site_ids`; audit actor recorded as `api_key`.
- **Migration test:** backfill on a copy of production-shaped data; effective access before and after is identical.
- **Performance:** resolved-grant lookup under 5 ms cached; per-site routes add at most one cached lookup.
- **UI:** keyboard-accessible matrix, empty and denied states, mobile layout.
- Existing gates stay: typecheck, lint, unit tests, ingestion load test (no change expected, ingestion is untouched).

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Migration changes who can see what | Backfill grants everything members have today; compare effective access before and after in a test |
| Permission checks missed on one route | Matrix test fails on any route without a declared permission |
| Per-request cost of grant resolution | One cached resolved set per user and workspace, 30 s, explicit invalidation |
| Scope creep from chat | Chat is a stretch goal with its own gate |
| Company tier confuses current single-workspace users | Single-workspace users never see the company page until they create a second workspace |
| Too many roles | Keep built-in roles few (Amplitude's own advice is five to seven); custom roles only in Phase 5 |

---

## 10. Out of scope for 0.2 (listed so nobody assumes it)

SSO/SAML and SCIM, IP allowlists, enforced two-factor, per-workspace retention policy UI, on-call schedules,
incident management and status pages, Jira / Linear / GitHub integrations. These are the beta 0.3+ backlog; the
permission model above leaves room for each.

---

## 11. Open decisions

1. Can a company have more than one owner? Proposed: yes, at least one always.
2. Does the company owner automatically count as admin inside every workspace? Proposed: yes, implicit, shown in the member list as "Company owner".
3. Should `member` with no team see anything? Proposed: no (deny by default after the backfill).
4. Chat in 0.2 or 0.3? Proposed: 0.3 unless Phases 0 to 5 finish early.
5. Version label: decided, see section 12.

---

## 12. Versioning

Decided: the product is **Beta 0.1** now and ships this plan as **Beta 0.2**. Beta 1.0 is reserved for the first
general-availability release.

- Packages stay at semver `0.1.0` while the product label is "Beta 0.1"; they move to `0.2.0` with this release.
- The label lives in `packages/landing/src/version.ts` (`RELEASE`), shown in the landing footer and the docs footer.
- `apps/web/src/lib/brand.test.ts` fails if `RELEASE.version` and the root `package.json` version disagree.
- Release step for 0.2: bump every `package.json` to `0.2.0` and `RELEASE.version` to `"0.2"` in the same commit.

---

## 13. Plans and billing (decided: demo gateway now, real gateway later)

Scope for 0.2: everything except the real payment gateway is production grade. The gateway is a replaceable adapter;
the first adapter is a **demo gateway** that moves no money.

### 13.1 Plans (single source: `packages/contracts`, `entitlements(plan)`)

| | Free | Pro |
|---|---|---|
| Workspaces per company | 1 | up to 3 |
| Websites | 1 | 10 |
| Events per month | 50,000 (hard cap) | 1,000,000 (soft cap, 120% grace) |
| Members (admin and member roles) | 2 including the owner | 10 |
| Viewers | 2 | Unlimited |
| Teams and per-site feature access | No | Yes |
| Data retention | 6 months | 24 months |
| Errors and releases | 1 site, limited groups | Full |
| Payments analytics | No | Yes |
| Funnels / goals / segments | 1 / 3 / 1 | Unlimited |
| API keys | 1 | 10 |
| Alert rules and channels | 1 email rule | Unlimited, plus Slack and webhook |
| Ask agent | 20 a month | 500 a month |
| Exports, public dashboard, audit log | CSV only, none, none | Yes, yes, yes |
| Support | Docs | Email |

Pro is sold monthly or yearly (yearly is about two months free; prices are config, not code). Existing beta workspaces
are grandfathered at their current event quota. Billing belongs to the **company**; the company owner and
`billing_admin` manage it (`company:billing`).

### 13.2 Gateway abstraction (`packages/billing`)

```ts
interface BillingGateway {
  createCheckout(input): { url: string; sessionId: string }
  createPortalSession(input): { url: string }
  changePlan(input): void            // monthly <-> yearly, with proration policy
  cancelAtPeriodEnd(input): void
  resume(input): void
  verifyAndParseWebhook(rawBody, headers): BillingEvent[]   // normalised, provider-agnostic
}
```

- Selected by `BILLING_PROVIDER=demo|stripe|razorpay`. Our code never imports a provider SDK outside its adapter.
- Normalised events: `checkout.completed`, `subscription.updated`, `subscription.canceled`, `invoice.paid`,
  `invoice.payment_failed`, `refund.created`. Everything downstream (entitlements, emails, audit) consumes only these.
- Adding Stripe or Razorpay later means one adapter plus a webhook route mapping, with no change to billing logic.

### 13.3 Demo gateway

- Hosted fake checkout page `/billing/demo/checkout` with test cards: success, declined, insufficient funds, and a
  "requires authentication" case. Shows a persistent **"Demo payments, no real money"** banner.
- It sends webhooks to our real webhook endpoint, signed with an HMAC secret, so the production webhook path
  (signature check, idempotency, ordering) is exercised from day one.
- Dev and staging controls: fast-forward the billing clock, fail the next renewal, expire a trial. These routes do
  not exist in production builds.
- Guard: the demo gateway refuses to start when `NODE_ENV=production` unless `BILLING_ALLOW_DEMO=true`, and the
  checkout page says so. A customer can never believe a demo payment is real.

### 13.4 Data model (Postgres)

| Table | Purpose |
|---|---|
| `billing_customers` | company_id, provider, provider_customer_id (replaces `stripe_customer_id` on workspaces) |
| `subscriptions` | company_id, plan, interval (`month`/`year`), status, current_period_start/end, trial_end, cancel_at_period_end, provider_subscription_id |
| `invoices` | company_id, subscription_id, number, amount_minor, currency, status, period, paid_at, provider_invoice_id; tax fields reserved |
| `billing_events` | provider, provider_event_id (unique), type, payload, processed_at; the idempotency and audit record |
| `plan_overrides` | company_id, plan or limits, reason, expires_at; for grandfathering and support exceptions |

Money is stored in minor units with an explicit currency. `workspaces.plan`, `stripe_customer_id`,
`stripe_subscription_id` are removed after migration; the plan comes from the company's subscription.

### 13.5 Subscription state machine

`trialing -> active -> past_due -> (grace expires) -> free` and `active -> cancel_at_period_end -> free`.
- 14-day Pro trial with no card; ends in Free unless a payment method is added.
- `past_due` keeps Pro for a 7-day grace period with email warnings on day 0, 3 and 6, then downgrades.
- Webhooks are idempotent (unique `provider_event_id`), tolerate out-of-order delivery by comparing period
  timestamps, and reject bad signatures with 400 and no side effects.
- Downgrade never deletes data: sites above the limit become read-only and stop ingesting after a 30-day notice;
  Pro-only features hide; teams and grants are kept but inactive; they return on upgrade.

### 13.6 Enforcement points

Site, workspace, team, member and viewer counts (pending invites count), API keys, alert rules, goals, funnels,
segments, Ask runs (counted per month), event cap at the edge (`monthly_event_quota` is written from the plan; hard on
Free, 120% grace on Pro), retention job, and the access resolver (plan intersected with role and team grants).
Blocked actions return `402 PLAN_LIMIT { limit, current, upgradeTo }` and the UI shows an upgrade prompt.
Limit checks run inside the same transaction as the insert so two concurrent requests cannot both pass.

### 13.7 UI

Company billing page (plan, interval, next renewal, payment method, invoices, usage versus limits, change plan,
cancel at period end, resume); upgrade prompts at each limit; usage warnings at 80% and 100%; "Demo payments" banner
while the demo gateway is active.

### 13.8 Tests and gates

- Gateway contract test suite that every adapter must pass (demo now, real adapters later).
- State machine tests for every transition, including trial expiry, failed renewal, grace expiry, resume.
- Webhook tests: duplicate, out-of-order, bad signature, replay.
- Concurrency test for limit enforcement; migration test that grandfathered workspaces keep their limits.
- Production guard test: demo gateway cannot start in production without the explicit flag.

### 13.9 Order inside beta 0.2

Phase 0 (permission fixes) -> company tier -> entitlements and limit enforcement -> billing tables, state machine and
demo gateway -> billing UI -> teams (Pro-gated) -> audit log -> basic issues (first to slip to 0.3).
Real gateway adapter (Stripe or Razorpay) is a separate task after 0.2 and needs no schema change.
