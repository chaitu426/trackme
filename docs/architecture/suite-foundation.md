# Suite foundation: what shipped

Plan and reasoning: [`docs/plans/suite-foundation-plan.md`](../plans/suite-foundation-plan.md). This file is the as-built state.

## Event envelope
- New kinds on `type`: `error`, `api_call`, `payment`, `flag_exposure`, `feedback`, `heartbeat`, `deploy`
  (`EVENT_TYPES` in `packages/contracts/src/events.ts`; mirrored in the Go edge validator and checked by the
  shared fixtures in `packages/contracts/fixtures/tracker-events.json`, which both test suites run).
- New optional fields `release` and `environment` on every event. See [`docs/features/releases.md`](../features/releases.md).
- Properties stay scalar-only; typed payloads for each new kind arrive with the feature that sends it.
- Hot path: the edge adds two string checks per event (a regex on `release`, a map lookup on `environment`).
  No lookup, no I/O.

## ClickHouse (migrations 014, 015; rollbacks in `down/`)
| Object | Purpose | Retention (table TTL) | Growth per 1M events (estimate) |
|---|---|---|---|
| `events_v2.release`, `.environment` | build and environment of each event | with events_v2 | ~0.3 MB (dictionary encoded) |
| `identity_map` | visitor to user, last identify wins | 25 months | ~30 MB per 1M *identified visitors*; 0 for anonymous traffic |
| `session_summary_agg` | one row per session per day | 90 days | ~50 B per session |
| `metric_rollup_minute` | suite kinds, total and by release | 7 days | ~1 MB |
| `metric_rollup_hour` | suite kinds by release, country, device, browser, path | 90 days | ~2 MB |
| `metric_rollup_day` | same, daily | 25 months | ~0.5 MB |

Estimates assume suite kinds are ~5% of events and ~6 dimension rows per event before merging; they are
arithmetic, not measurements. `session_summary_agg` and the rollups hold hashes and counts only. `identity_map`
holds user ids, so erasure deletes from it (`packages/analytics/src/erasure.ts`).

Rollups use materialized views (not worker counters), so they are exactly as reliable as the insert into
`events_v2`. Dimension cardinality capping (top 1,000 + other) is not built yet: it lands with the first feature
that writes a high-cardinality dimension (`path` on `error` events is the first candidate).

## Postgres (migration 0007)
`site_releases(site_id, version, commit, environment, deployed_at)`, unique on (site, version, environment).

## Access
- New API-key scope `write:deploys`, accepted only by `POST /api/v1/deploys`. API keys otherwise cannot reach
  session-protected routes (middleware requires a session cookie), so a reporting key is still not usable
  against `/api/v1/metrics` from outside the browser today.

## Not yet built
Visitor-to-user backfill into `session_summary_agg`, identity-conflict audit rows, dimension capping,
per-plan retention overrides for the new tables, SDK `release`/`environment` options, tenant-isolation
integration tests (need ClickHouse), ingestion load test.

## Verification state
Verified on 2026-11-09 against the project's Aiven services (Postgres, ClickHouse 26.3), which had no traffic for the
previous day:

- **Postgres:** `pnpm db:migrate` applied only `0007_site_releases` (8 migrations recorded); columns and both indexes checked.
- **ClickHouse up:** `migrate-clickhouse.mjs` applied 014 and 015 with no errors.
- **Pipeline test:** 7 synthetic events (one pageview, identify, 3 errors of which one from a known bot, 2 payments) written
  to `events_ingest` under a throwaway site id. Results: release and environment reach `events_v2`; the bot event is excluded
  from every aggregate; `identity_map` links the visitor hash to `user-42`; `session_summary_agg` shows entry page, last
  release, 2 errors, 2 payments and revenue 49,900 (only the captured payment); the minute, hour and day rollups carry the
  right per-release counts; pageviews do not enter the suite rollups. All test rows were deleted afterwards.
- **Rollback:** `--down` twice removed all 10 objects and both columns, restored the original view and cleared the
  migration records; re-applying brought everything back.

Not covered: behaviour under load (ingestion benchmark), part-creation pressure from the new views at volume, the full
Kafka-to-worker path (the test wrote to `events_ingest` directly, the table the worker writes), and tenant isolation
tests. The first live traffic after this point is the real check of the worker path.
