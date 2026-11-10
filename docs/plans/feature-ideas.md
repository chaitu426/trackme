# ROLE
You are a Staff Software Engineer joining the TrackMe codebase. You write production-grade code, optimized for time and space, that matches the existing codebase style exactly. You do not rewrite working code, add speculative abstractions, or add dependencies without written justification. You push back when an instruction conflicts with the existing architecture instead of silently deviating.

# PRODUCT CONTEXT
TrackMe is an analytics platform for developers and startup founders. We are expanding it into a full observability suite: one platform where a founder sees everything happening in their product (users, errors, performance, payments, growth) from a single shared timeline of events, users, sessions and releases.

Required ingestion flow (do not change):
user request -> SDK (served from CDN) -> Nginx reverse proxy -> ingestion service -> queue -> processing workers -> storage -> dashboard queries.

AWS is infrastructure only. No AWS-specific logic in application code; everything sits behind portable interfaces (queue, object store, cache, DB access).

# STEP 0: DISCOVERY (mandatory, before any code)
1. Read: ARCHITECTURE_OPTIMIZATION_PLAN.md, INGESTION_SCALE_ARCHITECTURE.md, README, dependency manifests (package.json / go.mod / Cargo.toml / requirements), all migrations and schema files, existing .excalidraw files, the sidebar/navigation component, the SDK source, and the realtime pipeline.
2. Produce a DISCOVERY REPORT (max 1.5 pages) covering:
   a. Stack: languages, frameworks, DB(s), queue, cache, object storage, deployment
   b. Event model: current schema, how user_id / anonymous_id / session_id are stored, existing indexes and partitioning
   c. How realtime numbers are produced today, and how dashboards query (raw vs rollups)
   d. Conventions: folder structure, naming, error handling, logging, config/env handling, API response envelope, validation approach, test framework and style, migration tool, UI component/styling/data-fetching patterns, state management
   e. Current SDK: bundle size (gzip), init options, transport (batching, sendBeacon, retry), identify/track API
   f. Risks or conflicts with the plan below
3. Do NOT assume the stack. Infer everything from the repo. STOP and wait for my confirmation.

# GLOBAL ENGINEERING RULES

## Style
- Copy the closest existing module before inventing a pattern. Same naming, structure, error handling, logging, response shapes, test layout.
- Reuse existing utilities, components, hooks and the existing Funnels engine before creating anything new.
- New dependency only if it removes >100 lines or is clearly necessary. State the name, size, license and why.
- No dead code, no TODO-driven stubs, no commented-out blocks.

## Time optimization
- Ingestion hot path is O(1) per event: authenticate project key, validate shape and size, enqueue, return 202. No DB reads, joins, enrichment or heavy compute on the request path. Target: no measurable p99 regression; show the benchmark or reasoning.
- Enrichment (geo, UA parsing, fingerprinting, identity stitching) happens in workers, not on the request path.
- Batch writes: flush by size (e.g. 1,000 rows) OR time (e.g. 1s), whichever comes first. Use bulk insert / COPY style APIs. Never one write per event.
- Dashboards read pre-aggregated rollups (1-minute, 1-hour, 1-day), never raw events, except single-user or single-session drill-downs.
- Every new query ships with its index/sort-key/partition reasoning. State expected rows scanned. Reject any plan that does a full scan of an events table.
- Cursor (keyset) pagination only. No OFFSET.
- Cache expensive dashboard queries with an explicit TTL and a stated invalidation rule. Use request coalescing so N identical dashboard loads trigger 1 query.
- Incremental aggregation: update rollups from the stream in workers; never recompute history on read.
- Background jobs are idempotent, resumable, and bounded in memory (stream, don't load all).

## Space optimization
- Retention per data class, enforced by an automated job (partition drop / TTL), not manual:
  - raw events: 30 days
  - error occurrences (sampled payloads): 30 days; error groups (fingerprint rows): 12 months
  - breadcrumbs: 14 days, attached to sampled occurrences only
  - rollups: minute 7 days, hour 90 days, day 25 months
  - payment events: 25 months (financial audit needs); raw gateway webhook payloads: 90 days
  - user timeline index: 90 days
  Make these configurable per project plan, with these as defaults.
- Compact types: enums or small ints over strings; low-cardinality dictionary encoding where the DB supports it; proper timestamp types; fixed-width ids; avoid per-row JSON for fields you query.
- Compress large JSON blobs (stack traces, breadcrumbs). Store each distinct error once per fingerprint with counters, plus a bounded sample (max 5 occurrences per group per day).
- Hard caps: event payload <= 32 KB, breadcrumbs <= 20 items of <= 200 chars each, stack frames <= 50, property keys <= 50 per event, string values truncated at 1 KB.
- Report expected storage growth per 1M events for every new table.

## SDK rules
- Core SDK size must not grow by more than 1.5 KB gzip. Everything else is lazy-loaded modules (errors, breadcrumbs, vitals extras, payments helper, feature flags), loaded only when enabled in config.
- Never throw into the host app. All SDK code is wrapped; failures are swallowed with an internal debug counter.
- Client-side dedupe and sampling for errors (same fingerprint max 1 send per 10s per session, hard cap 50 errors per session).
- Transport: batch, gzip when supported, sendBeacon on page hide, retry with exponential backoff and jitter, bounded offline queue (max 100 events, localStorage/IndexedDB with safe fallback).
- Report the gzip size delta for every SDK change.

## Correctness and safety
- Idempotent ingestion: event id (UUID/ULID) dedupe window of 24h (e.g. cache/set with TTL, or DB unique constraint on batch insert with conflict ignore).
- Multi-tenant isolation: every query, cache key, queue message and storage path includes project_id. Add automated tests proving cross-tenant reads are impossible.
- Payment webhooks: verify signatures with constant-time comparison, reject replays older than 5 minutes where the gateway provides a timestamp, idempotent by gateway event id, acknowledge fast (queue heavy work).
- PII: never store card numbers, CVV, full UPI IDs, auth tokens, passwords. Default scrubbers for emails, phone numbers, JWTs, bearer tokens, API keys in error messages, URLs (query-string allowlist) and breadcrumbs. Scrubbing runs in the SDK AND again on the server.
- Rate limiting per project and per IP at ingestion, with a graceful 429 and Retry-After. If the queue is slow or full: shed load (drop low-priority events like breadcrumbs first), never block or crash the host app.
- Secrets only from env/secret manager. Never logged.
- All new endpoints: authn/authz, input validation, consistent error envelope, request size limits.

## Quality bar for every feature
Migration with rollback, unit tests for core logic, integration test for the pipeline path, tenant-isolation test, short doc in /docs/<feature>.md, behind a feature flag, no regression in existing tests.

# SHARED FOUNDATION (build first; everything depends on it)
Extend the existing event model. Do not create a parallel one.

## Event envelope (adapt names to the existing schema)
- id (ULID), project_id, type (enum), ts (client time), received_at (server time), anonymous_id, user_id (nullable), session_id, release_version (nullable), environment (prod/staging/dev), url_path (normalized), properties (compact JSON, capped)
- New types: error, api_call, payment, flag_exposure, feedback, heartbeat, deploy
- Enrichment fields added by workers: country, region, city, device_class, browser, os, referrer_source (only if not already present)

## Identity stitching
- On identify(user_id): link anonymous_id -> user_id in an identity map table; backfill session -> user linkage lazily in a worker (bounded batch), never on the request path.
- Merge rule: one anonymous_id maps to at most one user_id; conflicts logged, last-write-wins with an audit row.

## Releases
- SDK config: release (string). Also a deploy webhook endpoint POST /api/v1/deploys (project key auth) with {version, commit, environment, deployed_at}. Store in a releases table; used by Release Impact Report and error release filters.

## Sessions
- Session = anonymous_id + 30 min inactivity window (reuse existing logic if present). Maintain a lightweight session summary row (first_seen, last_seen, entry_path, event_count, error_count, has_payment, revenue_amount) updated incrementally by workers. This table powers User 360, Revenue-Leak and Churn without scanning raw events.

## Rollups
Define a generic rollup mechanism (do not hand-roll one per feature): worker consumes events, updates counters keyed by (project_id, bucket_start, metric, dimension_hash) for minute/hour/day. Dimensions allowed: release, country, device_class, browser, path, gateway, payment_method, error_group_id. Cap dimension cardinality per metric (top 1,000 + "other") to bound space.

Deliver: migrations, ingestion validation, worker pipeline, rollup job, retention job, tests, doc. STOP for review.

# SIDEBAR / NAVIGATION RESTRUCTURE
Existing pages MOVE into suites. They are not rebuilt. Keep existing routes working (redirects if URLs change). Keep current visual style, icons, and active-state pattern. Suites are collapsible, with the collapsed/expanded state persisted. Items from unbuilt phases are hidden behind feature flags (no dead links).

1. ANALYTICS: Overview*, Realtime*, User Profiles*, User Journeys*, Funnels*, Acquisition*, Audience Geography*, Goals & Events*; NEW: Retention & Cohorts, Segments, Feature Adoption
2. PERFORMANCE: Page Performance* (moved), Web Vitals* (moved); NEW: Slow API Ranking, Performance by Segment
3. ERRORS & RELIABILITY (new): Error Tracking, Release Impact Report, Uptime & Synthetic Checks, Heartbeat Monitoring
4. PAYMENTS & REVENUE (new): Overview, Checkout Funnel, Payment Failure Doctor, Revenue-Leak Detector, Failed-Payment Recovery, Refunds & Disputes, Gateway Health, Integrations
5. CUSTOMERS & SUPPORT: User 360 Timeline (a new TAB inside the existing User Profile page, not a separate sidebar page), Churn Early Warning, Feedback & NPS, High-Value Accounts
6. GROWTH: Feature Flags, A/B Tests, Onboarding Tracker
7. ALERTS & INSIGHTS: Smart Alerts, What Changed?, Weekly Digest, Natural-language Query
(* = already exists)

Global UI rules: a global project switcher, date-range picker and release/environment filter shared across suites; filters persist in the URL; every table has loading, empty and error states; every chart is accessible (labels, not color alone); all heavy views stream or paginate.

# PHASES (ONE at a time; STOP after each and wait for approval)

## PHASE 1: Error Tracking + Retention + Segments

### 1A. Error Tracking
SDK module (lazy-loaded when errors: true):
- Capture window.onerror, unhandledrejection, failed fetch/XHR (status >= 500 or network failure; 4xx opt-in), console.error (opt-in).
- Breadcrumb ring buffer (max 20): navigation, click (element tag + safe selector + trimmed text, never input values), fetch/XHR (method, normalized URL, status, duration), custom log. Scrub per PII rules.
- Attach: release, environment, url_path, session_id, user_id, browser, a minimal app state tag set (user-defined tags max 10).
- Client dedupe/sampling as in SDK rules.
- API: TrackMe.captureException(err, {tags}), TrackMe.captureMessage(msg, level), TrackMe.setTag(k,v).

Backend:
- Fingerprinting (worker): normalize message (strip numbers, UUIDs, hashes, URLs -> placeholders) + top 3 in-app stack frames (function + file basename, no line numbers for minified builds) -> hash. Allow a custom fingerprint override from SDK.
- Tables:
  - error_groups(project_id, group_id, fingerprint, title, type, first_seen, last_seen, first_release, last_release, status[open|resolved|ignored], total_count, user_count_hll or small set, level)
  - error_group_daily(project_id, group_id, day, release_version, count, users_estimate)  // rollup, primary query path
  - error_occurrences(project_id, group_id, ts, session_id, user_id, release, stack_compressed, breadcrumbs_compressed, tags)  // sampled, max 5 per group per day
- Regression detection: if a resolved group reappears in a newer release, reopen and flag "regressed".
- Source maps: POST /api/v1/sourcemaps (project key + release + file). Store in object storage, keyed by project/release/file hash. De-minify in a worker with an LRU cache of parsed maps; never block ingestion. Show raw frames if no map. Delete maps beyond retention.
- Auto-link: each occurrence stores session_id so User 360 and Session summary update error_count.

UI (Errors & Reliability > Error Tracking):
- Issue list: title, type, events, users, first/last seen, trend sparkline (from error_group_daily), release badge; filters (status, release, environment, level, date); sort by last seen / events / users; cursor pagination.
- Issue detail: de-minified stack with in-app frames highlighted, breadcrumb timeline, affected users list (links to User Profile), release distribution, status actions (resolve, ignore, resolve-in-next-release), tag breakdown.
- Alerts hook: emit "new error group" and "regression" events to the alert engine (consumed in Phase 4; for now, just emit).

### 1B. Retention & Cohorts
- Rollup: per project, per cohort_day (first-seen day or first-event-of-type), per day_offset -> active_users. Computed incrementally from session summaries.
- UI: cohort triangle table (day/week/month granularity), heatmap shading with numbers, filter by segment, cohort definition selector (first visit / first event X / signup), return-event selector.
- Query path: reads only the retention rollup. Target < 200 ms p95 on 1M users.

### 1C. Segments
- segments(project_id, id, name, definition_json, created_by). Definition = AND/OR tree over user/session properties and event conditions; validated with a strict schema.
- A segment compiles to a parameterized query fragment (no string concatenation, injection-proof) reused by Funnels, Retention, Journeys, Overview. Add a segment picker to those pages.
- Cap: 50 segments per project; evaluation cost guardrail (reject definitions exceeding N conditions).

## PHASE 2: User 360 Timeline + Release Impact Report

### 2A. User 360 Timeline (unique feature)
- New tab in User Profile. Single chronological stream per user combining: page views, custom events, errors, payments (Phase 3), feedback, flag exposures.
- Source: a compact user_timeline index (project_id, user_id, ts DESC, kind, ref_id, summary, severity) written by workers; summaries are small strings, the detail is fetched lazily on expand. Keyset pagination by (ts, id).
- Features: filter by kind and severity, session grouping (collapsible), jump-to-error (links to error group), "copy debug link" (shareable internal URL), pinned important events (first seen, signup, first payment, last error).
- Header cards: first seen, last seen, sessions, total errors, total revenue (when available), current release, country/device.
- Performance: first page < 150 ms p95; no scans of raw events.

### 2B. Release Impact Report (unique feature)
- Trigger: deploy event (SDK release tag first appearing, or the deploy webhook).
- Compare window: N hours before vs N hours after (default 24h, min exposure threshold e.g. >= 500 sessions on the new release, else status "collecting data").
- Metrics: error rate (errors per 1k sessions), new error groups introduced, regressions, p75 LCP/INP, API p95, conversion rate for the primary goal, revenue per session (when payments exist).
- Statistics: use a two-proportion z-test for rates and a bootstrap or Mann-Whitney U for latency; report effect size and confidence; apply minimum-sample gates; label verdicts as Healthy / Watch / Regressed with the reasons shown (e.g. "Checkout error rate 3.1x higher on Safari, p<0.01, n=4,820"). Never show a verdict below the sample gate.
- Breakdown: by browser, country, device (using the rollup dimensions).
- Output: report page per release + optional Slack/webhook post with a link and a "suggested rollback" line only when Regressed with high confidence.
- Make the comparison fair: compare same weekday-hour pattern where possible (note seasonality limits in the UI tooltip).

## PHASE 3: Payments & Revenue

### 3A. Gateway layer
- Interface PaymentGateway { verifyWebhook(rawBody, headers), normalize(event) -> PaymentEvent, fetchMissing?(id) }. Implement Razorpay first, then Stripe. Adding a gateway = one new adapter file.
- Normalized PaymentEvent: gateway, gateway_event_id, payment_id, order_id, status (created|authorized|captured|failed|refunded|disputed), amount_minor (integer), currency, method (card|upi|netbanking|wallet|emi|other), failure_code_raw, failure_reason_norm, bank/issuer (if available), customer_ref, project user linkage (order/metadata carrying trackme user_id/session_id), created_at.
- Linkage: SDK helper TrackMe.payment.start({order_id, amount, currency}) emits a checkout event carrying session_id; webhook events join to sessions via order_id. Provide a server-side snippet to pass user_id/session_id into gateway order metadata. Document it.
- Store money as integer minor units. Never floats.
- Webhook endpoint: verify, dedupe, enqueue, return 200 in < 100 ms.

### 3B. Overview + Checkout Funnel + Gateway Health
- Overview: revenue, successful payments, success rate, AOV, MRR, new/expansion/churned MRR, LTV estimate (state the formula), ARPU. All from rollups.
- Checkout Funnel: reuse the existing Funnels engine with steps cart -> checkout_started -> payment_attempted -> payment_captured; break down by method and gateway.
- Gateway Health: rolling 5-minute and 1-hour success rate per gateway and method, baseline comparison, outage heuristic (success rate drop with enough volume), feeds the alert engine.

### 3C. Payment Failure Doctor (unique feature)
- Data-driven rules table (payment_failure_rules: match on gateway, failure_code_raw patterns, method, context predicates) -> category and suggested action. Categories: bank_decline, insufficient_funds, auth_failed (3DS/OTP), upi_timeout, upi_pending_expired, gateway_outage, network_error, app_bug, user_abandon, fraud_block, unknown.
- Context enrichment at classification time (worker): same-session errors in the last 2 minutes (app_bug signal), gateway success rate at that minute (gateway_outage signal), time between attempt and failure (timeout signal).
- Classification order: explicit gateway codes first, then context rules, else unknown. Store the matched rule id for explainability.
- UI: failures by category (counts and revenue at stake), top raw codes under each category, recommended action per category, drill-down to failed payments with the User 360 link, trend over time. Make the rules editable via config (seed file), not hard-coded.
- Track classifier coverage (% not unknown) as a health metric.

### 3D. Revenue-Leak Detector (unique feature)
- Join: session summaries + error occurrences + slow-page flags + failed/abandoned checkouts within the same session.
- Attribution method (document in UI): for each issue (error group or slow path), find sessions where the issue occurred BEFORE a checkout failure or abandonment in the same session; estimated loss = sum of cart/order amount of those sessions (use the order amount, fall back to the project's median order value, clearly labeled "estimated").
- Compare against a control: sessions without the issue convert at rate X; incremental loss = (control conversion - affected conversion) * affected sessions * AOV. Show both "associated" and "incremental estimate", with a confidence label and minimum-sample gate.
- UI: ranked list of issues by estimated money lost (this week / month), with the error group link, affected sessions, and a "fix this first" ordering. Export CSV.
- Compute incrementally with a nightly job over session summaries; no raw event scans.

### 3E. Failed-Payment Recovery + Refunds & Disputes
- Recovery: for each failed payment, track whether the same user/order succeeded within 24h/72h (recovered), via which method, and show recovery rate by failure category. Dunning hooks: emit events for webhook/email handoff (do not build an email system now).
- Refunds & Disputes: list with status, amount, reason, and link to the user's session/timeline; dispute deadline countdown where the gateway provides it.

## PHASE 4: Intelligence

### 4A. Smart Alerts
- Rules: metric (any rollup metric), condition (threshold or anomaly), window, minimum volume gate, channels, cooldown, severity.
- Anomaly baseline: median/MAD (robust z-score) vs same hour-of-week over the previous 4 to 8 weeks, with a fallback to a rolling window when history is short. Minimum volume gate to avoid noise at low traffic.
- Delivery: Slack webhook, email, generic webhook (WhatsApp via webhook provider). Dedup, grouping, cooldown, auto-resolve notification, delivery log with retries.
- Built-in presets: error spike, new error group in a new release, payment success rate drop, gateway outage, signup drop, LCP regression.
- Evaluate in a scheduler worker reading rollups only.

### 4B. What Changed?
- Input: metric + two time ranges (auto: anomaly window vs baseline). Output: dimensions ranked by contribution to the change (release, browser, country, device, gateway, path), using a decomposition over the rollups (difference in contribution to total, with a minimum support filter). Show a plain-language sentence for the top 3 drivers plus links to the relevant pages. No LLM required for correctness; an optional LLM only rephrases the findings.

### 4C. Churn Early Warning (unique feature)
- Scope: users/accounts with recent activity or an active subscription.
- Transparent scoring (store the components): usage drop (current 14d vs prior 14d sessions or key actions), error exposure (distinct error sessions in 14d), failed/declined payments, inactivity gap vs the user's own typical gap, downgrade or cancel intent events. Weighted sum into a 0-100 score with configurable weights; top 3 reasons stored per user.
- Daily batch job from session summaries and rollups; writes a churn_risk table (project_id, user_id, score, reasons, computed_at).
- UI: at-risk list sorted by score and revenue, reason chips, link to User 360, weekly "N users at risk" digest entry, export CSV. Provide a back-test view (did past high-risk users actually churn?) to build trust.

### 4D. Weekly Digest
- Scheduled summary: key metric deltas, top new errors, release verdicts, payment health, revenue leaks, at-risk accounts, with links. Email and Slack. Template-based, deterministic.

## PHASE 5: Expansion (plan each separately before building)
Feature Flags, A/B Tests (sequential-testing safe), Uptime & Synthetic Checks, Heartbeat Monitoring, Feedback & NPS, Onboarding Tracker, Slow API Ranking, Performance by Segment, Logs, LLM Observability, Cost per User, Natural-language Query. For each: problem statement, data model, hot-path impact, and retention before coding.

# WORKING PROTOCOL
For EACH phase (and each sub-feature if I ask):
1. PLAN first: files to add/change, schema changes, indexes and query plans, worker/queue changes, SDK size impact, risks, test plan. Wait for my "go".
2. IMPLEMENT in small, reviewable commits with clear messages. Do not touch unrelated code. Keep diffs minimal.
3. VERIFY: write tests; run linter, type-checker and the full test suite; fix failures. Include a load/benchmark check for ingestion and the heaviest new query.
4. REPORT: what changed; ingestion hot-path cost; new tables/indexes and projected growth per 1M events; retention jobs added; SDK gzip delta; feature flags added; known limitations; anything you deliberately did not do and why.
5. Raise any conflict between this plan and the existing architecture BEFORE implementing around it.

# DEFINITION OF DONE (per feature)
- Matches existing code and UI style
- Hot path not slowed (evidence provided)
- Queries indexed, keyset-paginated, tenant-scoped, rollup-backed
- Retention defined and enforced by job
- Migration has a tested rollback
- PII scrubbing verified by tests
- Tenant isolation test passes
- Unit + integration tests for core logic and the pipeline path
- Docs added in /docs
- Behind a feature flag until I approve
- No new dependency without written justification

# START
Do STEP 0 (Discovery) now and output the Discovery Report. Do not write any feature code yet.