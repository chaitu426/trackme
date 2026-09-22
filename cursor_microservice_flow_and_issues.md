# Microservice flow and issues
_Exported on 9/20/2026 at 17:39:38 GMT+5:30 from Cursor (3.0.12)_

---

**User**

give me the flow of each microservice and how this works end to end how traker workers what how it flows data from one serbice to other all etc and what are the problems or bugs in that as compaired to production system 

---

**Cursor**

I'll map the microservices and end-to-end data path first, then call out gaps vs a production-ready system.

Verifying a few critical path details so the flow and production gaps are accurate.

## End-to-end flow

This is a privacy-first analytics SaaS. The live path is:

```text
Browser (tracker.js)
    → ingestion-node (Fastify :3001)
    → Redis Streams (growth_events_stream)
    → event-worker
         ├─► ClickHouse (events_raw / web_vitals)
         └─► Redis (active:{siteId}:{sessionId})
    → apps/web (dashboard reads CH + Redis + Postgres)

scheduled-worker: cron rollups + usage metering (mostly unused by UI today)
ingestion-go: stub — accepts events, does NOT enqueue
```

---

### 1. Tracker (`packages/tracker`)

- Loaded as `tracker.js` from the web app with `data-site` (public key) + `data-endpoint` (e.g. `http://localhost:3001/v1/batch`).
- Collects: pageviews, SPA navigations, custom events, LCP/CLS web vitals.
- Identity: `sessionId` in `sessionStorage`, rotating daily `visitorPseudonym` in `localStorage` (no cookie).
- Transport: buffers (batch 10 / 2s), flushes on hide/unload via `sendBeacon`, else `fetch` + keepalive; failed fetch → localStorage retry queue.

---

### 2. Ingestion (`services/ingestion-node`)

`POST /v1/batch` (and `/v1/e` for single events):

1. Zod-validate payload  
2. Resolve `siteKey` → Postgres site via `publicKeyHash` (in-memory cache)  
3. Enrich: geo from CDN headers, bot/UA, URL sanitize (keep UTM/`ref`)  
4. `XADD` each event to Redis Stream  
5. Return **202 Accepted**

**`ingestion-go`** mirrors the HTTP shape but only returns 202 — no validation, no Redis. Do not route real traffic there.

---

### 3. Event worker (`services/event-worker`)

1. Consumer group on the Redis stream (`XREADGROUP` + `XAUTOCLAIM` for stale)  
2. Malformed → DLQ + ACK  
3. Write ClickHouse **first**, then ACK (failed write stays pending; poison after 5 tries → DLQ)  
4. Update realtime Redis keys (`active:{siteId}:{sessionId}`, TTL 300s; bots skipped)

---

### 4. Scheduled worker (`services/scheduled-worker`)

| Job | What |
|-----|------|
| Hourly rollups | `events_raw` → `pageview_rollups_hourly` |
| Daily rollups | → daily pageview/event rollups |
| Usage metering | CH counts → Postgres `usage_counters` |

Dashboards still query **`events_raw`**, not rollups.

---

### 5. Control plane (`apps/web`)

- **Postgres**: users, workspaces, sites, API keys, usage  
- **Auth**: custom HMAC cookie (`gi_session`), not NextAuth despite `NEXTAUTH_SECRET`  
- **Metrics**: `@trackme/analytics` queries ClickHouse; active visitors via Redis `SCAN`  
- **Realtime UI**: poll refresh (~5s), not SSE (README is outdated)

---

### Data stores

| Store | Role |
|-------|------|
| Postgres | Tenancy / auth / settings |
| Redis | Streams queue + DLQ + active sessions |
| ClickHouse | Raw events, vitals, rollup tables |

Docker Compose only runs Postgres / ClickHouse / Redis. App services run via `pnpm dev` on the host.

---

## Problems vs a production system

### Critical

1. **`ingestion-go` silently drops data** — returns success without enqueueing. Switching traffic would lose events while looking healthy.
2. **`sendBeacon` has no failure path** — if it returns `true`, HTTP errors are invisible; no retry. Only `fetch` failures hit the retry queue.
3. **Site privacy settings ignored server-side** — DNT, localhost, retention, vitals exist in DB/UI but ingestion never loads `sites.settings`.
4. **No retention enforcement** — `retentionMonths` / `DEFAULT_RETENTION_MONTHS` unused; data grows forever.
5. **Quota/billing unused** — usage is metered; nothing blocks or warns at `monthlyEventQuota`; Stripe columns unused.
6. **Rollups written but never read** — wasted cron work; dashboards always scan raw events (won’t scale).

### High / medium

7. **Unbounded site cache** — never invalidated; deleted/rotated keys keep working until restart.  
8. **Rate limits are in-process** — not Redis-backed; multi-instance limits don’t aggregate.  
9. **CORS `origin: true`** — no allowlist against `sites.domain`.  
10. **Realtime uses `SCAN`** — expensive at scale; no HyperLogLog / sorted sets.  
11. **Producer ignores pipeline errors** — Redis `exec()` replies not checked.  
12. **Incomplete product surface** — goals, audit logs, alerts, SSE, API key revoke, full web vitals UI mostly missing.  
13. **Observability stub** — logger unused; `console.log` only; no traces/metrics.  
14. **Docs mismatch** — tracker-docs omit required `data-endpoint`; README claims SSE/retention that aren’t implemented.  
15. **No real test suite** — `pnpm test` has little/nothing to run.  
16. **Scheduled worker has no lock** — multiple replicas can double-run jobs.  
17. **Ops friction** — forgetting `event-worker` leaves events stuck in Redis with no dashboard data.

### What already looks solid

- Unknown site keys rejected (401)  
- Worker ACK-after-ClickHouse (no silent drop on CH failure)  
- DLQ + redelivery / poison handling  
- Tenant scoping on metrics APIs  
- Idempotent-ish events via `eventId` + ClickHouse `ReplacingMergeTree`

---

**Bottom line:** The MVP path (tracker → Node ingest → Redis Streams → worker → ClickHouse → dashboard) is coherent. What’s missing for production is enforcement (privacy, retention, quota, domain allowlist), scale paths (rollups for reads, shared rate limits, cheaper realtime), safety around the Go stub / beacon reliability, and ops (observability, tests, multi-replica locks).

---

**User**

can you solve theis problems so it can run end to end on the test.html

---

**Cursor**

I'll get `test.html` and the local stack working end-to-end, focusing on whatever blocks that path.

Several blockers stand out for `test.html` e2e — notably `defer` breaking tracker init, the wrong tracker port, and infra likely being down. Fixing those next.

Infra is already up. Fixing the tracker init bug (`defer` + `currentScript`), transport reliability, and wiring `test.html` to a real seeded site.

Implementing the tracker/init and transport fixes, localhost enforcement, demo page, and a seed script.

Services are up. Verifying the full ingest → worker → ClickHouse path.

Two more blockers: middleware is gating `tracker.js`, and ClickHouse is rejecting ISO timestamps. Fixing both.

End-to-end path works now. Verified: ingest accepts events → worker writes ClickHouse (`pageview` + `demo_button_clicked` for your site key).

### What was broken (and fixed)

| Bug | Impact on `test.html` | Fix |
|-----|----------------------|-----|
| `document.currentScript` is `null` with `defer` | Tracker never initialized | Fall back to `querySelector('script[data-site][data-endpoint]')` |
| Wrong tracker URL (`:3005`) | Script 404 | Point to `:3000` |
| Middleware gated `/tracker.js` & `/demo.html` | Redirected to login | Public static assets allowed |
| ClickHouse rejected ISO `...Z` timestamps | Worker crashed; events stuck in Redis | Format as `YYYY-MM-DD HH:MM:SS.mmm` |
| Site privacy / localhost not applied | Demo would fail once settings were enforced | Load settings; demo site seeded with `allowLocalhostTracking: true` |
| `sendBeacon` had no failure retry | Silent drops on normal flushes | `fetch` for normal flushes; beacon only on unload |

### How to use it

Services are already running locally. Open:

**http://localhost:3000/demo.html**

(not `file://…/test.html` — CORS/localStorage are unreliable from `file://`)

You should see “Tracker loaded”, then within ~2s a pageview hits ingestion. Click the button for `demo_button_clicked`.

If you restart later:

```bash
pnpm seed:demo          # ensures demo site key exists
pnpm --filter @trackme/ingestion-node dev
pnpm --filter @trackme/event-worker dev
pnpm --filter @trackme/web dev
```

---

**User**

ok it works make this system more robost and the production grade and aaaccurate it should feel like instent and reliable use go where ever req 

---

**Cursor**

Making the hot path production-grade: Go ingestion at the edge, faster/accurate metrics, and realtime that feels instant. Mapping the highest-impact gaps first, then implementing.

Implementing Go edge ingestion first, then realtime (SSE + Redis sets), hybrid metrics, and reliability gates.

Building the Go ingestion edge and hardening realtime, metrics, and reliability in parallel.

---

**User**

contiue

---

**Cursor**

Continuing production hardening from where the writes were interrupted. Checking what's already on disk.

Finishing the Go service and applying the TypeScript reliability upgrades.

Fixing invalid Go switch syntax, then implementing the TypeScript hardening.

SSE auth needs `workspaceId` — fixing the route to resolve the site first.

Fixing the breakdowns fallback logic, then adding retention, Node quota/domain checks, and a snappier tracker.

Fixing `go.mod` and cleaning up the leftover `io` reference.

---

**User**

hi

---

**Cursor**

Hi — picking up where we left off.

**Done so far**
- Go ingestion edge (validate → enrich → Redis Streams + rate limit + quota)
- Realtime ZSET index + SSE live panel
- Hybrid rollup/raw metrics
- Retention job, domain allowlist, snappier tracker flush (500ms / batch 5)

**Still pending**
- Finish `go build` / `pnpm install` and verify e2e with Go on `:3001`

Want me to finish the build + verification now?

---

**User**

continue

---

**Cursor**

Finishing the Go build and verifying the end-to-end path.

Switching port 3001 to Go ingestion and verifying the full pipeline.

Production hardening is in place and verified.

### Verified now
- **Go ingestion** on `:3001` → `{"service":"ingestion-go","status":"ok"}`
- Batch accepted → event-worker → **ClickHouse** (`pageview` + `demo_button_clicked`)

### What shipped

| Area | Change |
|------|--------|
| **Go edge** | Real collector: site lookup, enrich, Redis Streams, shared rate limit, quota gate, domain/privacy |
| **Realtime** | Redis ZSET index + **SSE** (`/api/v1/sites/:id/realtime/stream`) — ~1s updates |
| **Metrics** | ≤48h from `events_raw`; longer ranges use daily rollups (`FINAL`) |
| **Reliability** | Retention cron, quota, domain allowlist (Node + Go), snappier tracker (500ms / batch 5) |

### Run locally
```bash
pnpm seed:demo
pnpm --filter @trackme/ingestion-go dev   # or: pnpm dev:ingest
pnpm --filter @trackme/event-worker dev
pnpm --filter @trackme/web dev
```

Open **http://localhost:3000/demo.html** — events go through Go. Realtime page uses live SSE instead of 5s full refresh.

Node ingest remains as `pnpm dev:ingest:node` if you need the fallback.

---

**User**

what the main concerns with this system in real world 

---

**Cursor**

Here’s what still matters most in the real world, even after the recent hardening:

### Reliability & data integrity
- **At-most-once vs exactly-once**: ClickHouse `ReplacingMergeTree` helps retries, but late duplicates, partial batches, and clock skew still create soft under/over-counts.
- **Queue is Redis Streams**: fine for MVP; at high volume you want Kafka/NATS JetStream (longer retention, replay, multi-AZ durability). Redis AOF/RDB alone is a weaker durability story.
- **Go + Node dual collectors**: easy to misroute traffic; one must be the only production path.
- **Beacon path**: unload still uses `sendBeacon` with no HTTP status → silent loss on 4xx/5xx/network filters.

### Scale & cost
- **Raw-first queries**: short windows are fine; long ranges with bounce/duration still hit `events_raw`. Rollups help volume KPIs, not full engagement accuracy at scale.
- **Realtime SSE polls Redis every 1s per open dashboard** → many concurrent dashboards = Redis + Node load. Needs fan-out (pub/sub) or shared poller.
- **Site cache / quota in Redis** can drift until metering sync; quota isn’t a hard billing control yet.
- **ClickHouse mutations for retention** are expensive; table TTL is the production pattern.

### Privacy / compliance
- **Public site keys** are forgeable: anyone with the key can spam ingest (rate limit helps, doesn’t stop determined abuse).
- **Domain allowlist is weak**: easy to spoof URLs; true protection needs Origin/Referer checks + optional signed tokens / first-party proxy.
- **DNT / localhost settings** are best-effort; GDPR/CCPA need consent UX, DPA, retention proofs, subprocessors, regional residency — not just flags.
- **Geo from CDN headers only**: no edge geo → empty country; wrong if you sell “geo analytics.”

### Security
- **CORS `origin: *`-style reflection** is intentional for trackers but widens abuse surface.
- **API middleware bypasses all `/api/*`** — every new route must auth correctly or it’s public.
- **No WAF / bot farm story** beyond UA regexes (trivial to bypass).
- **Secrets in `.env` / session cookies** — ops risk if leaked (you already had a `cookie.txt`-style artifact around).

### Product accuracy
- **Bots, ad blockers, ITP, Safari, Brave** will systematically undercount vs GA; that’s normal for privacy-first, but sales/customers need clear methodology.
- **Sessions / bounce / duration** are heuristic (pseudonym + sessionStorage); multi-device and cross-day journeys won’t match “true” identity analytics.
- **Web vitals incomplete** (LCP/CLS mostly); dashboards may overclaim “CWV.”
- **Rollup UNIQUE sums across days overcount visitors** (sum of daily uniques ≠ period unique). That’s a classic analytics pitfall still present in the hybrid path.

### Ops / multi-tenant SaaS
- **No distributed lock on scheduled jobs** → duplicate rollups/metering if you run multiple replicas.
- **Weak observability**: limited structured logs, no traces/SLOs/alerts on ingest lag, DLQ depth, CH insert failures.
- **No multi-region / failover** story for Postgres, Redis, or ClickHouse.
- **Billing/Stripe unused** — usage is counted, not charged or enforced as a product.
- **Single-tenant mental model in places** (one primary site patterns) vs many sites/workspaces under load.

### Bottom line
The pipeline is **credible for a privacy-first MVP**: tracker → Go edge → Redis → worker → ClickHouse → dashboard, with realtime that feels live.

For real customers at volume, the top risks are: **Redis-as-queue durability**, **abuse of public keys**, **under-counting vs blockers**, **rollup unique math**, **SSE fan-out cost**, and **ops (retention TTL, locks, observability, single ingest path)**. Those are what separate “works on demo.html” from “runs as a paid analytics SaaS.”

---

**User**

At-most-once vs exactly-once: ClickHouse ReplacingMergeTree helps retries, but late duplicates, partial batches, and clock skew still create soft under/over-counts.
Queue is Redis Streams: fine for MVP; at high volume you want Kafka/NATS JetStream (longer retention, replay, multi-AZ durability). Redis AOF/RDB alone is a weaker durability story.
Go + Node dual collectors: easy to misroute traffic; one must be the only production path.
Beacon path: unload still uses sendBeacon with no HTTP status → silent loss on 4xx/5xx/network filters.
use kafka, only go,

---

**Cursor**

Switching the ingest path to Kafka-only with Go as the sole collector. Mapping the current queue wiring first.

Implementing Kafka end-to-end and making Go the only ingest path.

---

**User**

continue

---

**Cursor**

Checking build state and finishing the Kafka + Go-only cutover.

Kafka is up. Creating topics and wiring Go ingest + the event-worker.

Topics are ready. Starting services in smaller steps — the previous run got cut off.

Go was publishing Snappy-compressed messages; kafkajs doesn't support that by default. Switching the producer to Gzip and restarting.

Clearing Snappy messages stuck on the topic, then restarting the consumer.

Done. Verified end-to-end: **Go → Kafka → ClickHouse**.

### What changed
| Before | After |
|--------|--------|
| Redis Streams queue | **Kafka** (`growth_events` + `growth_events_dlq`) |
| Go + Node ingest | **Go only** (Node package deprecated, no `dev` script) |
| `sendBeacon` first on unload | **`fetch` + keepalive** first; beacon only as last resort |
| Snappy (broke kafkajs) | **Gzip** compression |

### Delivery model
- Produce: `acks=all`, key = `eventId`
- Consume: commit offsets **after** ClickHouse write (at-least-once)
- Dedup: `event_id` + `ReplacingMergeTree` → effectively exact reads

### Run
```bash
pnpm docker:up          # includes Kafka on :9092
pnpm --filter @trackme/ingestion-go dev
pnpm --filter @trackme/event-worker dev
pnpm --filter @trackme/web dev
```

Env (already in `.env` / `.env.example`): `KAFKA_BROKERS`, `KAFKA_TOPIC`, `KAFKA_DLQ_TOPIC`, `KAFKA_CONSUMER_GROUP`.

---

**User**

Public site keys are forgeable: anyone with the key can spam ingest (rate limit helps, doesn’t stop determined abuse).
Domain allowlist is weak: easy to spoof URLs; true protection needs Origin/Referer checks + optional signed tokens / first-party proxy.
DNT / localhost settings are best-effort; GDPR/CCPA need consent UX, DPA, retention proofs, subprocessors, regional residency — not just flags.
Geo from CDN headers only: no edge geo → empty country; wrong if you sell “geo analytics.”

---

**Cursor**

Hardening ingest against key spam and spoofing, adding consent gating, and edge geo when CDN headers are missing.

Implementing Origin/Referer enforcement, HMAC signing, per-site rate limits, consent gating, and MMDB-based edge geo.

Fixing signing to store a server-only secret (required for HMAC verify), then continuing implementation.

---

**User**

continue

---

**Cursor**

Finishing the tracker TypeScript fix and verifying origin enforcement.

Verified. Origin enforcement is live:

- `evil.example` → **403**
- `localhost:3000` → **202**
- missing Origin → **403**

### What each concern got

| Concern | What we shipped |
|--------|------------------|
| **Forgeable public keys** | Per-**site** Redis rate limits (not just IP) + optional **HMAC** (`X-GI-Signature`) + rotate secret API |
| **Weak domain allowlist** | **Origin/Referer** must match site domain (`requireOriginMatch`, default on) + URL host check |
| **DNT / GDPR flags only** | Tracker **consent gate** (`requireConsent` / `grantConsent()`), privacy form toggles, `/legal/privacy` + `/legal/dpa` templates, retention note |
| **CDN-only geo** | Transient IP → **MMDB** lookup (`GEOIP_MMDB_PATH`); CDN headers still preferred; IP never stored on events |

### How to use

```bash
# Optional edge geo DB
pnpm geoip:download
# then in .env: GEOIP_MMDB_PATH=./infra/geoip/country.mmdb

# First-party proxy (keeps signing secret off the page)
SIGNING_SECRET=gis_... INGEST_URL=http://localhost:3001 go run ./services/ingest-proxy
# point data-endpoint at the proxy, enable signingRequired in site settings
```

Consent snippet:
```html
<script defer src=".../tracker.js" data-site="..." data-endpoint="..." data-require-consent="true"></script>
<script>window.growth?.grantConsent()</script> <!-- after CMP accept -->
```

**Still not “full compliance”:** a real DPA, subprocessor list, residency SLAs, and a CMP are business/legal work — the product now has the technical hooks those programs need.

---

**User**

Product accuracy
Bots, ad blockers, ITP, Safari, Brave will systematically undercount vs GA; that’s normal for privacy-first, but sales/customers need clear methodology.
Sessions / bounce / duration are heuristic (pseudonym + sessionStorage); multi-device and cross-day journeys won’t match “true” identity analytics.
Web vitals incomplete (LCP/CLS mostly); dashboards may overclaim “CWV.”
Rollup UNIQUE sums across days overcount visitors (sum of daily uniques ≠ period unique). That’s a classic analytics pitfall still present in the hybrid path.

---

**Cursor**

Fixing the rollup unique-count bug, aligning web-vitals coverage with the UI, and adding clear methodology so customers know what the numbers mean.

Implementing accurate uniques, fuller web vitals, and methodology copy.

Addressed the accuracy gaps:

### Uniques (the real bug)
- **Overview**: visitors/sessions always `uniqExact` over the **selected period** on `events_raw`. Rollups only supply **additive pageviews** on long ranges.
- **Breakdowns**: dropped `sum(unique_visitors)` across days — always period `uniqExact`.
- KPI subtitle now says **“Period uniques (not sum of daily)”**.

### Web vitals
Tracker now reports **LCP, CLS, INP, FCP, TTFB** (plus FID fallback). Settings copy no longer claims a full CWV suite — “best-effort… sample counts vary.”

### Methodology (for sales/customers)
Overview has an expandable **“How these metrics are calculated”** note covering:
- period uniques vs daily sums  
- sessionStorage sessions (not cross-device identity)  
- bounce / duration heuristics  
- privacy-first undercount vs GA (blockers, ITP, DNT/consent)  
- vitals sample variance  

Sessions/bounce/duration stay heuristic by design for a cookieless product — the fix is honest labeling + correct unique math, not fake cross-device identity.

---

**User**

Raw-first queries: short windows are fine; long ranges with bounce/duration still hit events_raw. Rollups help volume KPIs, not full engagement accuracy at scale.
Realtime SSE polls Redis every 1s per open dashboard → many concurrent dashboards = Redis + Node load. Needs fan-out (pub/sub) or shared poller.
Site cache / quota in Redis can drift until metering sync; quota isn’t a hard billing control yet.
ClickHouse mutations for retention are expensive; table TTL is the production pattern. rdis is better or kafka

---

**Cursor**

I'll dig into the raw-query paths, realtime SSE polling, Redis quota/cache, and ClickHouse retention so we can harden those hotspots.

Implementing engagement rollups, SSE fan-out, quota hardening, and ClickHouse TTL retention.

Implementing the four fixes now.

Fixing quota rollback on publish failure, then site-cache invalidation and metering.

Adding a raw fallback when engagement rollups are empty (before the first daily job).

Shipped the four scale/accuracy fixes:

### Long-range engagement
- New `session_engagement_daily` rollup + daily job
- Ranges **>48h**: bounce/duration from rollups; pageviews from pageview rollups; period uniques still `uniqExact` (no window scan)
- Short/filtered: session-weighted raw (fixes event-weighted duration)
- Empty rollups fall back to raw once

### Realtime fan-out
- Worker `PUBLISH rt:notify:{siteId}` on writes
- Process-shared hub: one Redis read + pub/sub wake serves all SSE clients; 5s fallback for TTL expiry
- Fixed cancel cleanup (no leaked intervals)

### Quota / site cache
- Atomic Redis `TryReserve` (hard gate); release on Kafka publish failure
- Metering uses `max(ch, redis)` — no more SET clobbering live INCR
- Settings/signing rotate → `site:invalidate` pub/sub; Go + Node drop cache by hash

### ClickHouse retention
- Migrations `004`/`005`: engagement table + **TTL** (`ttl_only_drop_parts`)
- Retention job: **DROP PARTITION** only (no DELETE mutations)

Apply when CH is up:
`004_session_engagement.sql`, `005_table_ttl.sql`

---

**User**

Chat with your data
Weekly digest report
Revenue attribution
Real-time analytics
GDPR compliant
Cookieless tracking
Visitor-level data
Identify users
Core Web Vitals
No consent banner
Public page
Script size
< 1 KB
~45 KB
< 1 KB
~3 KB
Starting price
$9/mo
Free*
$9/mo
$9/mo
Events which fetures we have and which not

---

**Cursor**

I'll map those marketing features against what's actually implemented in the codebase.

| Feature | Status | Notes |
|---------|--------|--------|
| Chat with your data | **No** | Not built |
| Weekly digest report | **No** | No email/digest jobs |
| Revenue attribution | **No** | Marketing only; no order/revenue events |
| Real-time analytics | **Yes** | Redis + SSE live dashboard |
| GDPR compliant | **Partial** | Privacy/DPA pages, IP discard, retention, consent hooks — DPA is a template, not legal review |
| Cookieless tracking | **Yes** | `sessionStorage` / `localStorage` pseudonym; no tracking cookies |
| Visitor-level data | **No** | Aggregates only; no journey/profile UI |
| Identify users | **No** | No `identify` / `user_id` API |
| Core Web Vitals | **Partial** | Collects LCP/CLS/INP/FCP/TTFB; no CWV dashboard page yet |
| No consent banner | **Yes** | Consent optional (`requireConsent` default off) |
| Public page | **Yes** | Opt-in `/share/[slug]` |
| Script size | **~3 KB gzip** (~9.5 KB raw) | Between “&lt;1 KB” and “~45 KB” competitors |
| Starting price | **Partial** | Plan/quota fields exist; no Stripe checkout or public pricing |
| Custom events | **Partial** | `trackEvent()` + ingest/rollups; no goals/events UI |

**Have today:** realtime, cookieless, optional no-banner, public share, custom event collection, GDPR-oriented plumbing.

**Don’t have:** AI chat, weekly digests, revenue attribution, visitor profiles, identify users.

**Half-done:** CWV (data in, UI out), billing (schema in, checkout out), goals (schema in, product out).

---

**User**

list all half build and full build fetures

---

**Cursor**

I'll inventory the product surface and classify each feature as full or half-built.

