# TrackMe

A production-grade, privacy-first, multi-tenant B2B SaaS for web analytics, error tracking, and payments insight. It combines a lightweight browser tracker, a Go ingestion edge, a Kafka + ClickHouse event pipeline, and a Next.js control plane — plus **Ask**, an in-app AI agent that answers questions over a workspace's own data with grounded, cited evidence.

Built on Next.js 15 (App Router), TypeScript, Go, ClickHouse, PostgreSQL, Redis, and Kafka.

## Architecture

```text
Browser tracker (~5 KB gzip)
    │
    ▼
Go Ingestion Edge (services/ingestion-go)   ← only production collector
    │   Redis: rate limit + quota
    ▼
Apache Kafka (growth_events / growth_events_dlq)
    │   key=siteId:sessionId · acks=all · at-least-once delivery
    ▼
TypeScript Event Worker (services/event-worker) ──► ClickHouse events_raw
    │   (ReplacingMergeTree collapses duplicate event_id)
    ├─► Redis realtime ZSET index + TTL sessions
    ▼
Next.js Control Plane (apps/web)
    ├─► PostgreSQL (tenancy, users, sites, api keys, ask_runs)
    ├─► ClickHouse (raw ≤48h, rollups for longer ranges)
    └─► Redis SSE realtime streaming (1s snapshots)

scheduled-worker: hourly/daily rollups, usage metering, retention
ask-worker:       Ask runs — OpenAI planner over vetted query templates
```

### Ask (the in-app agent)

Ask is a floating panel in the dashboard that answers natural-language questions ("Where do visitors drop off in checkout?") from the workspace's own data. It is deliberately safe and scalable:

- A **decoupled worker** (`services/ask-worker`) consumes runs from a Redis Stream, plans with an OpenAI model, and streams steps and the answer back over SSE. The web request only enqueues; adding worker replicas adds throughput.
- The model never writes SQL and never supplies the tenant condition. It picks a **vetted query template** (`packages/ask`) with typed, zod-validated parameters; each template wraps an existing analytics query that already binds `workspace_id`/`site_id`.
- Client scope (range, row cap, sources) is **clamped server-side**; ClickHouse queries run under `max_execution_time` / `max_result_rows`.
- A mechanical **grounding gate** drops any figure not present in the cited evidence's sample before the answer is stored.
- Cost is bounded by a shared Redis budget (per-workspace concurrency + a global completions-per-minute bucket), and every run is written to `ask_runs` and the audit log.

Ask runs in two modes, chosen by `NEXT_PUBLIC_ASK_MODE`: `demo` (canned answers, no key needed) or `live` (real planner). See `docs/ask-agent.md`.

## Repository Structure

```text
apps/
  web/                         Next.js dashboard, marketing site, and control plane
  tracker-docs/                Integration guides and public developer documentation
services/
  ingestion-go/                Production Go edge collector → Kafka
  event-worker/                Kafka consumer and ClickHouse batch writer
  scheduled-worker/            Rollups, retention, and usage counters
  ask-worker/                  Ask runs: OpenAI planner → templates → grounding → Postgres/SSE
  ingest-proxy/                Go reverse proxy in front of the ingestion edge
packages/
  landing/                     Shared marketing landing page rendered by both apps
  contracts/                   Zod schemas, versioned event types, and API contracts
  config/                      Typed environment configuration validation
  authz/                       Multi-tenant workspace/site authorization guards
  db/                          PostgreSQL Drizzle schema, migrations, and tenant pooler
  analytics/                   ClickHouse query layer, metric definitions, and client
  payments/                    Payment gateway integrations (Razorpay, Stripe)
  object-store/                File/object storage abstraction
  ask/                         Ask contract, scope clamping, templates, planner, grounding, budget, queue
  tracker/                     Lightweight (~5 KB gzipped) browser tracking SDK
infra/
  docker/                      Docker Compose: Postgres, ClickHouse, Redis, Kafka
  migrations/                  PostgreSQL (Drizzle) and ClickHouse DDL scripts
  observability/               Structured logging, traces, and metrics
docs/                          Design and architecture notes (incl. ask-agent.md)
```

## Quick Start

### 1. Prerequisites
- Node.js >= 20.0.0
- pnpm >= 9.0.0 (repo pins 10.5.2 via `packageManager`)
- Go >= 1.22
- Docker and Docker Compose (for local infrastructure)

### 2. Setup
```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start local infrastructure (Postgres, ClickHouse, Redis, Kafka)
pnpm docker:up

# 3. Install dependencies
pnpm install

# 4. Run database migrations
pnpm db:migrate

# 5. Seed the demo site used by /demo.html
pnpm seed:demo

# 6. Start services (in separate terminals)
pnpm --filter @trackme/ingestion-go dev
pnpm --filter @trackme/event-worker dev
pnpm --filter @trackme/web dev
```

Open http://localhost:3000/demo.html to verify tracker → Go → Kafka → ClickHouse.

### Running everything at once

```bash
pnpm start:all      # web + docs + ingestion + event-worker + scheduled-worker + ask-worker (production builds)
```

### Enabling Ask (live mode)

Ask ships in `demo` mode (canned answers, no key). To answer from real data:

1. Set in `.env`:
   - `ASK_ENABLED=true`
   - `OPENAI_API_KEY=sk-...`
   - `NEXT_PUBLIC_ASK_MODE=live`
2. Run migrations so the `ask_runs` table exists (`pnpm db:migrate`).
3. Start the worker: `pnpm start:ask` (or include it via `pnpm start:all`).
4. Restart the web app — `NEXT_PUBLIC_ASK_MODE` is baked in at build time.

The worker prints `ask worker: consuming as ask-w… (model …)` when it is live. Full variable reference is in `docs/ask-agent.md` and `.env.example`.

### Shared landing page and docs

The public landing page is implemented once in `packages/landing`. Both `apps/web`
and `apps/tracker-docs` render that workspace package at `/`; their page files only
provide links for the app running at that origin. This keeps the design and content
identical without coupling the apps' Next.js routes.

Run the apps in separate terminals:

```bash
pnpm --filter @trackme/web dev
pnpm --filter @trackme/tracker-docs dev
```

The web landing is at http://localhost:3000 and the docs landing at
http://localhost:3002. `NEXT_PUBLIC_DOCS_URL` and `NEXT_PUBLIC_DASHBOARD_URL` in
`.env` must be set to the public origins of the docs and dashboard apps when
deploying; both variables are included in Turbo's environment cache key so a
build cannot reuse landing links generated for different origins.

## Tests

Tests are kept beside the source they cover and use the `*.test.ts` naming
convention. Run all workspace tests with `pnpm test`, or run one package's tests
with `pnpm --filter @trackme/tracker test` (replace the package name as needed).
The Go services keep tests beside their packages and use Go's standard
`*_test.go` convention; run them with `go test ./...` from the service directory.

The scheduled worker's ClickHouse integration test is skipped in the normal
test run unless `CLICKHOUSE_TEST_URL` is configured. To run it explicitly, use
`pnpm --filter @trackme/scheduled-worker test:integration`.

## Core Principles & Guarantees
- **Privacy by Default**: No tracking cookies required. IP addresses are processed transiently for geolocation then immediately discarded.
- **Tenant Isolation**: Every database query, cache key, and analytical scan is explicitly scoped to verified `workspace_id` and `site_id`.
- **At-least-once ingest**: Kafka offsets commit only after ClickHouse write succeeds; `event_id` + ReplacingMergeTree provides idempotent reads.
- **Grounded answers**: Ask never shows a free-standing number — every figure cites evidence, and the grounding gate enforces it before an answer reaches the UI.
