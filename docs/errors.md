# Error Tracking: as built (Phase 1A, backend)

Plan: [`phase1-plan.md`](phase1-plan.md). Foundation: [`suite-foundation.md`](suite-foundation.md).
**Status:** the SDK, the pipeline from the edge to storage and the storage are built and verified. Issue status,
the regression job, source maps and the dashboard pages are **not** built yet.

## Event shape
An event with `type: "error"` carries an `error` object (and no other kind may):

| Field | Limit |
|---|---|
| `type` (e.g. `TypeError`) | 1 to 128 chars |
| `message` | up to 1,024 chars |
| `level` | `fatal`, `error`, `warning`, `info` (default `error`) |
| `fingerprint` | optional custom grouping key, up to 128 chars |
| `frames` | up to 50: `{fn?, file, line?, col?, inApp?}`, innermost first |
| `breadcrumbs` | up to 20: `{ts, k: navigation\|click\|fetch\|log, m (up to 200 chars)}` |
| `tags` | up to 10 string pairs, key up to 32, value up to 200 |

The whole request is still limited to 32 KB. The caps live in `ERROR_LIMITS` (`packages/contracts`) and are
mirrored in the Go edge; 12 shared fixtures run in both test suites so they cannot drift.

## What happens to an error
1. **Edge** checks shape and sizes only. No stack inspection, no lookups.
2. **Worker** (before the normal event insert): scrubs the payload again (`scrubErrorPayload`: emails, phone numbers,
   UPI ids, cards by Luhn, JWTs, bearer/basic tokens, API keys, passwords, URL query values outside an allowlist),
   computes the group id, and sets the event's `properties` to `{groupId, errorType, level}` so session summaries and
   rollups count it like any other event.
3. **Grouping:** `sha256(site | type | normalized message | top 3 in-app frames)`, 64 bits. Numbers, UUIDs, hex and URLs
   in the message are replaced; frames use function and file name only (no line numbers, no bundle content hash).
   A custom `fingerprint` replaces all of that. The site id is in the hash, so ids are never shared across tenants.
4. **Storage** (migration 016): `error_events` (one compact row per error, 30 days) feeds `error_groups` (one row per
   issue, 12 months) and `error_group_daily` (per issue per day per release and environment, 12 months).
   `error_occurrences` keeps the stack, breadcrumbs and tags for the first 5 errors per issue per UTC day (a Redis
   counter decides; 30 days). The columns use ClickHouse's own ZSTD codec, so no application-side compression.

Bots keep their event (excluded from aggregates by `bot_status`) but get no error rows.

## Operational behaviour
- Error rows are best-effort relative to the events: if they fail to store, the batch is **not** replayed (that would
  duplicate every event in it). Watch `worker_error_write_failures_total`; a non-zero rate means lost error counts.
- If Redis is unreachable the counts are stored but detail rows are skipped (`worker_error_sampler_failures_total`).
- There is no per-event dedupe in `error_events`: a worker crash between the insert and the offset commit can double-count
  that batch's errors. The same risk exists for the legacy tables; events_v2 is protected by its insert token.
- "Users" is the identified user if the SDK sent one, otherwise the visitor pseudonym, which rotates every 24 hours.

## Privacy
`error_occurrences.user_id` holds the id passed to `identify()`. If your app uses emails as user ids they are stored
there and in `identity_map`, the same as in profiles. Erasure (`eraseVisitor`) removes the person from
`error_events`, `error_occurrences` and `identity_map`. Group-level aggregates keep no identifier.

## Verified
Migration 016 applied, rolled back and re-applied on the project's Aiven ClickHouse. The real worker code
(`prepareErrorEvents`, `createErrorWriter`) was run against real ClickHouse and Redis with 8 varying reports of one bug,
a bot error and a pageview: one issue, 4 distinct users, per-release daily counts, 5 of 8 detail rows kept, no secret
in storage; test rows removed. **Not verified:** the full Kafka path, load, and tenant isolation tests.

## SDK
Built and verified in a real browser: see [`sdk.md`](sdk.md) (options, API, what is collected, sizes).

## Still to build in 1A
Issue status (Postgres) and the once-a-minute regression job; source maps (`POST /api/v1/sourcemaps`, object store,
de-minify); the Error Tracking list and issue pages behind the `errors` flag.
