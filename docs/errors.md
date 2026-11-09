# Error Tracking: as built (Phase 1A, backend)

Plan: [`phase1-plan.md`](phase1-plan.md). Foundation: [`suite-foundation.md`](suite-foundation.md).
**Status:** the SDK, the pipeline from the edge to storage and the storage are built and verified. Issue status,
source maps are **not** built yet.

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

## Dashboard (Errors & Reliability > Error Tracking)
In the sidebar under Errors & Reliability.

- **Issue list** (`/<workspace>/sites/<site>/errors`): title, level, status, first seen, release, a daily trend, events,
  users and last seen. Filters for status (open by default), release, environment, level, sort (last seen, events,
  users) and range, all in the URL. Keyset pagination ("Next 25"), no OFFSET. Loading, empty (with the snippet to
  turn capture on), filtered-empty and error states.
- **Issue page** (`.../errors/<id>`): stack with your own code highlighted, breadcrumbs timed against the error,
  events per day, release split, tag counts, affected users (each opens the People page searched for that user),
  an occurrence picker, and the actions below.
- **Actions:** Resolve, Resolve in next release, Ignore, Reopen. Members and above can change status (`sites:update`);
  viewers see none. Each change is audit-logged.
- **Status** lives in Postgres `site_error_status` (migration 0008); the rules are in `packages/contracts/src/error-status.ts`.
- **Regressions:** a job runs every minute (`error_regressions`). A plainly resolved issue reopens on any new
  occurrence. One resolved "in next release" reopens only for a release it had not been seen in, so old builds still in
  the wild do not reopen it. The issue is marked "Regressed in <release>". The job is idempotent and never overrides a
  change a person made while it ran.
- **Caching:** results are cached for 30 seconds with single-flight, stale-while-revalidate and early refresh
  (`cached()` in `query-cache.ts`), so many dashboards loading together cost one query.

### Reading the numbers
- Events and the trend are exact. "Users affected" counts the identified user when the SDK knew one and otherwise the
  visitor pseudonym, which rotates every 24 hours, so an anonymous person seen on several days counts once per day.
- Stack, breadcrumbs, tags and the affected-users list come from the sampled occurrences (5 per issue per day), not
  from every event.

## Verified
Queries ran against the real ClickHouse with three seeded issues over three days: all three sorts, keyset paging,
release/environment/level filters, include/exclude id lists, trends, release split, occurrences, tags, a wrong
site or workspace returning nothing, and a hostile cursor ignored. The regression job ran against the real Postgres
and ClickHouse for four scenarios (resolved and returned; old build under "next release"; newer build; quiet) and
was idempotent on a second run. `next build` compiles both pages and the status route.
**Not verified:** the pages rendered in a browser (they sit behind login), the status buttons end to end, and
behaviour with a large number of issues.

## Still to build in 1A
Source maps (`POST /api/v1/sourcemaps`, an object store, de-minifying in the worker).
