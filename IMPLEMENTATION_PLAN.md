# Growth Intelligence Platform Implementation Plan

## 1. Product strategy

Build a privacy-first, multi-tenant analytics SaaS for B2B SaaS founders and small teams.

The first product promise is:

> Install one script, verify traffic in minutes, trust the numbers, and understand which sources create valuable customers.

The first release should prove reliable measurement and repeat dashboard usage. Revenue attribution, alerts, and advanced product analytics come after the tracking and metric foundations are stable.

## 2. Technology split

### Node.js and TypeScript: primary platform

- Next.js App Router for marketing, onboarding, dashboard, and route handlers.
- TypeScript service modules for authorization, sites, goals, billing, API keys, exports, and dashboard queries.
- TypeScript tracker SDK published as a small browser bundle.
- TypeScript workers for queue consumption, ClickHouse writes, rollups, retention, exports, and alerts.
- PostgreSQL for users, workspaces, memberships, sites, goals, plans, integrations, API keys, audit logs, and jobs.
- ClickHouse for immutable analytics events, rollups, funnels, and analytical queries.
- Redis for rate limits, active visitor state, short-lived cache, locks, and realtime coordination.
- Managed queue initially; add Kafka or Redpanda only when volume or replay requirements justify it.

### Minimal Go: one focused service

Use Go for the public ingestion edge only when load testing shows that the Node ingestion path is a bottleneck.

The Go service should remain deliberately small:

- Accept versioned tracker batches.
- Validate the public site key, origin, payload size, and event UUIDs.
- Apply basic rate limits and request-level enrichment.
- Redact or reject unsafe properties.
- Publish the normalized event envelope to the queue.
- Return a fast acknowledgement.

It must not own product rules, dashboard queries, billing, tenancy policy, or ClickHouse schema migrations. Node and Go share versioned JSON or Protobuf event contracts and contract tests. Until the need is demonstrated, run the same interface in Node/Fastify to reduce operational cost.

## 3. Target architecture

```text
Browser tracker
    |
    v
CDN/WAF -> ingestion edge (Node first, Go later)
    |
    v
Managed queue -> TypeScript event worker -> ClickHouse raw events
                                  |             |
                                  |             +--> hourly/daily rollups
                                  +--> Redis realtime state

Next.js control plane -> PostgreSQL
                    \-> ClickHouse query service
                    \-> Redis cache/SSE
                    \-> Stripe, email, exports
```

Start as a modular monorepo, not a collection of microservices. Keep modules and queue contracts clean enough that the ingestion edge and workers can be deployed separately later.

## 4. Suggested repository layout

```text
apps/
  web/                         Next.js dashboard and control plane
  tracker-docs/                Installation and API documentation
services/
  ingestion-node/              Node/Fastify collector for MVP
  ingestion-go/                Optional Go collector after load validation
  event-worker/                Queue consumer and ClickHouse writer
  scheduled-worker/            Rollups, retention, alerts, exports
packages/
  contracts/                   Zod schemas and versioned event types
  tracker/                     Browser SDK
  authz/                       Workspace/site authorization helpers
  db/                          PostgreSQL and migration access
  analytics/                   ClickHouse queries and metric definitions
  config/                      Typed environment configuration
infra/
  docker/                      Local PostgreSQL, ClickHouse, Redis, queue
  migrations/                  PostgreSQL and ClickHouse migrations
  observability/               Dashboards and alerts
```

## 5. Core data model

### PostgreSQL

- `users`
- `workspaces`
- `workspace_members`
- `sites`
- `site_domains`
- `goals`
- `api_keys`
- `plans`, `subscriptions`, `usage_counters`
- `integrations`
- `audit_logs`
- `export_jobs`
- `deletion_jobs`

Every workspace-owned table gets `workspace_id`. Site-owned records also get `site_id` where useful for efficient authorization and indexing. API keys and site keys are stored as hashes; plaintext is shown once.

### ClickHouse

- `events_raw`: append-only, versioned, deduplicated by `event_id`.
- `pageview_rollups_hourly` and `pageview_rollups_daily`.
- `event_rollups_daily`.
- `web_vitals`.
- `revenue_events` when the Stripe phase begins.

Use explicit metric definitions for visitors, sessions, pageviews, conversions, and revenue. Store event timestamps in UTC and apply workspace timezone only at query and presentation boundaries.

### Redis

- `active:{site_id}:{session_id}` with a short TTL.
- `realtime:{site_id}` activity counters or streams.
- scoped rate-limit keys.
- query-cache keys containing workspace and site scope.
- worker lock keys.

## 6. Event contract and privacy rules

The tracker sends a versioned envelope:

```ts
type TrackerEvent = {
  schemaVersion: 1;
  eventId: string;
  type: "pageview" | "custom" | "web_vital";
  occurredAt: string;
  siteKey: string;
  sessionId: string;
  visitorPseudonym: string;
  url: string;
  path: string;
  referrer?: string;
  campaign?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  properties?: Record<string, string | number | boolean>;
};
```

Enforce the contract at the browser, ingestion, queue consumer, and API boundaries.

- No cookies required for basic analytics.
- Do not collect form contents, passwords, payment data, email addresses, or arbitrary PII.
- Strip query parameters except approved UTM parameters.
- Apply property key/value limits, depth limits, and cardinality limits.
- Process IP transiently for country and bot checks, then discard or truncate it.
- Support DNT and explicit consent mode.
- Give each site configurable retention and deletion controls.
- Keep raw and filtered counts separate so exclusions are explainable.

## 7. Delivery phases

### Phase 0: foundation, 1-2 weeks

Deliver:

- pnpm/Turborepo monorepo with strict TypeScript.
- Next.js app shell and original B2B design system.
- Local PostgreSQL, ClickHouse, Redis, and queue via Docker Compose.
- Auth, workspace creation, memberships, and server-side authorization.
- CI for lint, typecheck, unit tests, migrations, and deploy previews.
- Structured logs, correlation IDs, error tracking, and basic OpenTelemetry.

Exit condition: a user can sign in, create a workspace and site, and deploy the test environment safely.

### Phase 1: tracking and measurement MVP, 3-4 weeks

Deliver:

- Async tracker under the initial size budget.
- Pageview on initial load and SPA history transitions.
- `sendBeacon` transport with keepalive fetch fallback.
- Batch ingestion endpoint with Zod validation and idempotent event IDs.
- Queue producer and TypeScript ClickHouse consumer.
- Raw event table and hourly/daily rollups.
- Onboarding installation instructions and first-event verification.
- Overview, pages, referrers, UTM, device, country, sessions, and date filters.

Exit condition: a real test site can install the snippet and dashboard counts reconcile with synthetic events within a documented tolerance.

### Phase 2: paid beta, 3-4 weeks

Deliver:

- Custom events with property constraints.
- Conversion goals and conversion reports.
- Redis-backed realtime activity with authorized SSE.
- Core Web Vitals collection and p75 reporting.
- Privacy settings, DNT/consent mode, retention, and deletion workflow.
- Bot detection and an inspectable exclusion summary.
- Usage counters, quotas, warnings, and Stripe Billing for platform subscriptions.
- Support documentation and a measurement health center.

Exit condition: 10-20 design partners can self-install, understand data freshness, and return to the dashboard weekly.

### Phase 3: revenue intelligence, 4-6 weeks

Deliver:

- Stripe customer/subscription/payment/refund synchronization.
- Server-side consented customer reference mapping; never infer identity from email in the browser.
- Revenue event normalization and reconciliation jobs.
- First-touch and last-non-direct attribution with coverage/confidence indicators.
- Source, campaign, and landing-page contribution views.
- CSV exports, scoped read API keys, rate limits, and audit records.
- Scheduled anomaly rules and email notifications.
- Limited public dashboards with expiring, scoped links.

Exit condition: a customer can identify which acquisition sources produce subscriptions and understand attribution limitations.

### Phase 4: defensibility, after product validation

- Funnels and retention cohorts.
- MRR movements, churn, and source-to-LTV.
- Slack reporting, annotations, scheduled digests, and richer RBAC.
- Warehouse export and first-party proxy.
- Introduce Kafka/Redpanda or the Go ingestion service only from measured operational need.

### Phase 5: enterprise and AI

- Grounded AI analyst over a semantic query layer.
- SSO/SAML, SCIM, enterprise audit/compliance controls.
- Agency white label and regional deployment.

Do not start AI before metric definitions and query traces are stable. Every answer must show the executed query, filters, freshness, and source data.

## 8. Security and tenancy gates

Every feature must pass these checks before release:

1. Authorization derives workspace/site scope from the verified session, API key, or server-side site lookup, never from an untrusted client ID alone.
2. PostgreSQL queries, ClickHouse queries, Redis keys, exports, jobs, and public links include tenant scope.
3. Public site keys can only write events; they cannot read analytics or mutate settings.
4. Secrets use a managed secret store and third-party credentials use envelope encryption.
5. API keys are hashed, scoped, expirable, revocable, and shown only once.
6. All input boundaries use Zod or an equivalent schema validator.
7. Rate limits, payload limits, WAF rules, CSP, secure headers, and CSRF protection are enabled where applicable.
8. Retention, export, deletion, and audit actions are observable and retryable.

## 9. Testing strategy

- Unit tests: sessionization, attribution, rollups, quota calculations, bot classification, URL normalization, PII filtering.
- Contract tests: tracker payloads accepted identically by Node and Go ingestion implementations.
- Integration tests: workspace/site authorization, API key scopes, queue retries, ClickHouse inserts, Stripe webhooks.
- Browser tests: installation wizard, first-event verification, SPA route deduplication, dashboard filters, realtime fallback.
- Synthetic monitoring: send known events continuously and compare expected versus reported counts.
- Load tests: ingestion acknowledgement latency, queue backlog recovery, ClickHouse batch size, dashboard p95.
- Security tests: cross-tenant IDs, cache-key collisions, replayed event IDs, malformed properties, oversized payloads, expired links.

## 10. Operational targets

- Tracker: less than 2 KB gzip for the core bundle where practical.
- Ingestion: p95 acknowledgement under 200 ms in the primary region.
- Common dashboard queries: p95 under 1.5 seconds.
- Realtime: visible within seconds, with an explicit freshness state if delayed.
- Idempotency: duplicate event submissions do not change reported counts.
- Degradation: historical analytics remains available when Redis or realtime is unavailable.
- Cost: enforce event quotas, retention TTLs, query range limits, and per-workspace usage visibility.

## 11. First implementation backlog

1. Create the monorepo, local infrastructure, environment schema, and CI.
2. Add PostgreSQL migrations for users, workspaces, members, and sites.
3. Implement auth and a reusable server-side authorization context.
4. Build the tracker package and SPA route tests.
5. Define the versioned event contract and ingestion validation.
6. Implement Node ingestion, queue publishing, and a ClickHouse writer worker.
7. Add raw event deduplication and hourly pageview rollups.
8. Build onboarding and first-event verification.
9. Build the overview and pages reports with URL-persisted filters.
10. Add realtime, custom events, goals, privacy controls, and quotas.
11. Add billing and revenue integration only after measurement reconciliation passes.

## 12. Decisions to confirm before coding

- Initial hosting and managed providers for PostgreSQL, ClickHouse, Redis, queue, object storage, and secrets.
- EU-first data region or another explicit initial region.
- Auth provider: Auth.js, Clerk, or WorkOS.
- Queue choice for local and hosted environments.
- Initial plan limits and overage policy.
- Exact anonymous session and visitor pseudonym policy after legal review.
- Whether the first beta needs Core Web Vitals or should keep it behind the paid-beta milestone.

The recommended build order is intentionally measurement-first: a clean event contract, tenant authorization, idempotency, privacy controls, and metric definitions are prerequisites for trustworthy revenue intelligence and any later AI layer.