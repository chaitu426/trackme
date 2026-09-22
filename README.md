# Growth Intelligence Platform

A production-grade, privacy-first, multi-tenant B2B SaaS web analytics and growth intelligence platform built on Next.js 15 App Router, TypeScript, Go, ClickHouse, PostgreSQL, Redis, and Kafka.

## Architecture

```text
Browser tracker (<2KB gzip)
    │
    ▼
Go Ingestion Edge (services/ingestion-go)   ← only production collector
    │   Redis: rate limit + quota
    ▼
Apache Kafka (growth_events / growth_events_dlq)
    │   key=eventId · acks=all · at-least-once delivery
    ▼
TypeScript Event Worker (services/event-worker) ──► ClickHouse events_raw
    │   (ReplacingMergeTree collapses duplicate event_id)
    ├─► Redis realtime ZSET index + TTL sessions
    ▼
Next.js Control Plane (apps/web)
    ├─► PostgreSQL (tenancy, users, sites, api keys)
    ├─► ClickHouse (raw ≤48h, rollups for longer ranges)
    └─► Redis SSE realtime streaming (1s snapshots)

scheduled-worker: hourly/daily rollups, usage metering, retention
```

## Repository Structure

```text
apps/
  web/                         Next.js dashboard, marketing, and control plane
  tracker-docs/                Integration guides and public developer documentation
services/
  ingestion-go/                Production Go edge collector → Kafka
  event-worker/                Kafka consumer and ClickHouse batch writer
  scheduled-worker/            Rollups, retention, and usage counters
  ingestion-node/              DEPRECATED (do not run in production)
packages/
  contracts/                   Zod schemas, versioned event types, and API contracts
  config/                      Typed environment configuration validation
  authz/                       Multi-tenant workspace/site authorization guards
  db/                          PostgreSQL Drizzle schema, migrations, and tenant pooler
  analytics/                   ClickHouse query layer, metric definitions, and client
  tracker/                     Lightweight (<2KB) browser tracking SDK
infra/
  docker/                      Docker Compose: Postgres, ClickHouse, Redis, Kafka
  migrations/                  PostgreSQL and ClickHouse DDL scripts
  observability/               Structured logging, traces, and metrics
```

## Quick Start

### 1. Prerequisites
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Go >= 1.22
- Docker and Docker Compose

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

# 6. Start services (in separate terminals, or via turbo excluding deprecated node ingest)
pnpm --filter @trackme/ingestion-go dev
pnpm --filter @trackme/event-worker dev
pnpm --filter @trackme/web dev
```

Open http://localhost:3000/demo.html to verify tracker → Go → Kafka → ClickHouse.

## Core Principles & Guarantees
- **Privacy by Default**: No tracking cookies required. IP addresses are processed transiently for geolocation then immediately discarded.
- **Tenant Isolation**: Every database query, cache key, and analytical scan is explicitly scoped to verified `workspace_id` and `site_id`.
- **At-least-once ingest**: Kafka offsets commit only after ClickHouse write succeeds; `event_id` + ReplacingMergeTree provides idempotent reads.
