# Suite Foundation: Plan (for review, no code yet)

Scope: the shared base every suite feature needs (event envelope, identity, releases, sessions, rollups,
retention). Names follow the repo, not the brief: `project` = `site` (inside `workspace`), ids stay UUID,
`anonymous_id` = the existing `visitorPseudonym`. Nothing here changes the ingestion flow.

## 1. Decisions taken (change any before "go")

| # | Decision | Why |
|---|---|---|
| D1 | Rollups are ClickHouse materialized views off `events_v2`, not worker counters | Matches principle 1 of `ARCHITECTURE_OPTIMIZATION_PLAN.md`; no new worker state to keep exactly-once |
| D2 | Workers do only what MVs cannot: identity stitching, error fingerprinting, source-map de-minify, PII re-scrub | Keeps the hot path and MVs simple |
| D3 | New tables get the brief's retention defaults; `events_v2` keeps its per-site 12/24/36-month promise | Cutting raw to 30 days would break shipped Journeys, Funnels, Profiles |
| D4 | Core SDK stays within the CI budget (10,500 B gzip, 448 B free). Errors and breadcrumbs are a lazy module; `web-vitals` moves out of core to buy headroom | The +1.5 KB core allowance does not fit |
| D5 | Raw `user_id` strings are stored only in `user_timeline` and `error_occurrences`, both covered by retention and erasure | Sessions and visitors are hashes today; User 360 and affected-users need the id |
| D6 | UUID event ids; 24 h dedupe stays the edge Redis claim (`EDGE_DEDUPE`) | A ULID switch would touch the SDK, edge and worker for no gain |
| D7 | Down-migrations: `NNN_name.down.sql` beside each up file, `--down` added to `infra/aiven/migrate-clickhouse.mjs` | The repo has no rollback convention today |
| D8 | Phase 4 alerts extend `alert_rules` / `alert_channels`, not a new engine | They already exist |

## 2. Event envelope (contracts, edge, worker)

- `type` enum gains `error`, `api_call`, `payment`, `flag_exposure`, `feedback`, `heartbeat`, `deploy`.
  `events_v2.type` is `LowCardinality(String)`, so no ClickHouse change.
- New optional top-level fields on `TrackerEvent`: `release` (max 64), `environment`
  (`production|staging|development`, default production). They become `events_v2` columns
  `release LowCardinality(String)`, `environment LowCardinality(String)` (migration 014).
- Typed payload per new kind (zod, strict), e.g. `error: {type, message<=1KB, frames<=50, breadcrumbs<=20x200}`.
  `properties` stays scalar-only and unchanged. The 32 KB body cap already exists (`MAX_EVENT_PAYLOAD_BYTES`).
- Edge (Go) change: accept the new fields and kinds, size-check only. No lookups, no enrichment: the
  hot path stays O(1). Evidence will be the existing ingestion load test before and after.
- Deploy order matters: worker and edge accept the new kinds first, SDK ships last.

## 3. Tables (ClickHouse migration 014+, each with a `.down.sql`)

| Table | Engine / key | Fed by | Growth per 1M events (est) | Retention |
|---|---|---|---|---|
| `identity_map(site_id, visitor_hash, user_id, linked_at)` | ReplacingMergeTree(linked_at), ORDER BY (site_id, visitor_hash) | worker on `identify` | ~25 MB only for identified visitors | 25 mo |
| `session_summary_agg` | AggregatingMergeTree, ORDER BY (site_id, date, session_hash): first/last ts, entry path, event/error counts, has_payment, revenue_minor | MV on `events_v2` | ~40 B per session | 90 d |
| `metric_rollup_minute/hour/day` | SummingMergeTree, ORDER BY (site_id, bucket, metric, dim, dim_value) | MVs on `events_v2` | minute ~2 MB, hour ~0.5 MB, day ~0.1 MB | 7 d / 90 d / 25 mo (TTL) |
| `releases` | Postgres: (site_id, version, commit, environment, deployed_at), unique (site_id, version, environment) | `POST /api/v1/deploys`, or first-seen `release` | negligible | 25 mo |

- Dimension cap (top 1,000 + "other"): enforced by a nightly job rewriting `dim_value` to `other` beyond the cap, because an MV cannot rank.
- Identity merge: one visitor maps to at most one user; a conflict keeps the newest and writes an audit row (Postgres `audit_logs`).
  Session-to-user backfill is a bounded-batch worker task, never on the request path.
- Every table carries `site_id` in its key; every query takes it from the authorised site, never from client input.

## 4. Retention job

Extend `services/scheduled-worker/src/jobs/retention.ts` with a table-to-default map (the brief's values), overridable
per workspace plan. Prefer partition drop / `ttl_only_drop_parts`; the job only handles per-site overrides.

## 5. Read path

Dashboards read `metric_rollup_*` and `session_summary_agg` through the existing Redis single-flight cache
(`cached-analytics.ts`), keyset-paginated, with TTLs of 30 s for minute data and 5 min for hour or day data,
invalidated by TTL only (data is append-only).

## 6. Tests and gates

Unit: envelope schemas, caps, scrubbers, merge rule. Integration (skipped without ClickHouse, like the existing ones):
send event, then expect it in the rollup. Tenant isolation: two sites, every new query returns zero rows for the other.
Down-migration: apply, roll back, apply again.

## 7. Flags

No feature flags: a finished page goes straight into the sidebar (`apps/web/src/lib/nav.ts`). Decision: the owner approved shipping everything unflagged and asked that nothing be flagged in future.

## 8. Risks

- The v2 pipeline is still in shadow rollout (`ANALYTICS_READ=v1`). Rollups built on it need `WORKER_WRITE_V2` set to `shadow` or `only` first.
- ClickHouse part pressure (F6 in `INGESTION_SCALE_ARCHITECTURE.md`): each new MV adds insert-time work. I will count MV targets per insert before adding any and stop at the agreed budget.
- I could not run ClickHouse or the load test here, so benchmark evidence needs your environment.

## 9. Done so far

Sidebar suites, persisted collapse state and flag gating are in. Nothing in this plan is implemented.
