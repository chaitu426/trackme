# Phase 1 plan: Error Tracking, Retention & Cohorts, Segments (for review, no code yet)

Builds on [`docs/architecture/suite-foundation.md`](../architecture/suite-foundation.md) (migrations 014 and 015 are live and verified).

## 0. Conflict to decide first: anonymous visitors cannot be followed across days

`packages/tracker/src/session.ts:18` rotates the visitor pseudonym every 24 hours, and the privacy page promises it.
Consequences, none of which the brief anticipated:

| Feature | Effect |
|---|---|
| Retention & Cohorts | Day-N retention is meaningless for anonymous traffic: yesterday's visitor and today's are different ids. It can only cover **identified users** (`identity_map`, set by `identify()`). |
| "Users affected" on an error | Counts pseudonyms. Over a multi-day range one person is counted once per day. Identified users are exact; anonymous counts are labelled "visitor-days". |
| Churn, new vs returning (Phases 2 and 4) | Same limit. |

**Recommendation:** build Retention on identified users only, and say so on the page ("based on N identified users").
Do not change the pseudonym policy: it is a stated privacy guarantee. If you want anonymous retention, that is a separate
product and legal decision (a longer-lived, consent-gated id).

## 1. Decisions taken (change any before "go")

| # | Decision | Why |
|---|---|---|
| P1 | Error detail is a new typed envelope field `error`, not `properties` | `properties` is scalar-only with 256-character strings; a stack and breadcrumbs do not fit |
| P2 | Fingerprinting and PII re-scrubbing happen in the worker; the edge only checks shape and size | Keeps the request path O(1) |
| P3 | Group counters come from materialized views over a compact `error_events` table | Same pattern as the foundation; the worker writes one small row per error |
| P4 | Group status (open, resolved, ignored) lives in Postgres; regression detection is a once-a-minute job | Status is mutable and low volume; the hot path never reads it |
| P5 | Source-map storage sits behind an `ObjectStore` interface with a filesystem adapter first; the S3 adapter waits for your OK on a dependency | The repo has no object store; an S3 client is a new dependency |
| P6 | The "new group / regression" alert hook is **not built** in Phase 1 | An emit with no consumer is dead code; the hook point is documented and added with Phase 4 |
| P7 | SDK budget: move `web-vitals` into a lazy chunk to free about 2 KB of the 10.5 KB CI budget | Core has 448 B free; release/environment config and the error loader need about 600 B |

## 2. 1A Error Tracking (build order)

1. **Contracts + edge.** `error` object: `{type, message<=1 KB, frames<=50 {fn,file,line,col,inApp}, breadcrumbs<=20 x <=200 chars, level, tags<=10, fingerprint?}`.
   Edge checks counts and lengths only. Shared fixtures run in both suites.
2. **Scrubber.** One pattern list in `packages/contracts` (emails, phone numbers, JWTs, bearer tokens, API keys, URL query
   strings kept to an allowlist). The SDK bundles it; the worker applies it again. Tests with real-looking secrets.
3. **Worker.** Normalise message (numbers, UUIDs, hashes, URLs to placeholders) + top 3 in-app frames (function and file
   basename) to a 64-bit `group_id`; honour an SDK fingerprint override. Writes:
   - `error_events(site_id, group_id, ts, release, environment, session_hash, user_hash, level)`: about 40 B a row, 30-day TTL. Hot table.
   - `error_group_daily` and `error_groups_agg` by MV (count, first/last seen, `uniq` state for users, first/last release).
   - `error_groups_meta(site_id, group_id, title, type, level)`: ReplacingMergeTree, written once per new group, 12-month TTL.
   - `error_occurrences(site_id, group_id, ts, session_hash, user_id, release, stack_zstd, breadcrumbs_zstd, tags)`: sampled, at most 5 per group per day
     (Redis `INCR` with a day TTL as the counter), 30-day TTL. Stack and breadcrumbs are zstd-compressed by the worker (the repo already has `zstd-codec`).
4. **Regression job** (scheduled-worker, 1 min): resolved groups with new events in a newer release are reopened and marked regressed.
5. **Source maps.** `POST /api/v1/sourcemaps` (API key with a new `write:sourcemaps` scope); `ObjectStore` interface; de-minify in the worker with an LRU of parsed maps (new dependency `source-map`, ~60 KB, BSD-3, needed because parsing VLQ maps by hand is >100 lines); raw frames when no map exists; delete maps past retention.
6. **SDK.** Lazy `errors` chunk loaded when `data-errors="true"`: `onerror`, `unhandledrejection`, failed `fetch`/XHR (5xx and network failures; 4xx opt-in), `console.error` opt-in, 20-item breadcrumb ring, dedupe (same fingerprint once per 10 s per session) and a 50-per-session cap. API: `captureException`, `captureMessage`, `setTag`. Everything wrapped, never throws into the host. Reports the gzip delta.
7. **UI** (Errors & Reliability > Error Tracking, behind the `errors` flag): issue list (status, release, environment, level, range filters; sort by last seen, events, users; keyset pagination on `(last_seen, group_id)`; sparkline from `error_group_daily`), and the issue page (stack with in-app frames highlighted, breadcrumbs, affected users, release distribution, resolve/ignore/resolve-in-next-release, tag breakdown). Existing `RankingList`, tables and range switcher.

Hot path: the edge adds a bounded structural check on one optional field; no lookups. Growth per 1M error events: `error_events` about 40 MB, `error_occurrences` bounded by the 5-per-group-per-day cap (about 300 B x groups x 5 x days, independent of volume).

## 3. 1B Retention & Cohorts
- A materialized view cannot join `identity_map` at insert time, so activity per user is built after the fact. Two options:
  a worker step that resolves each event's visitor to a user through a Redis-cached `identity_map` lookup, or a nightly job that reads yesterday's events joined to `identity_map`. I recommend the nightly job: no new hot-path work, and a cohort is a day-granularity answer anyway.
- Nightly job writes `retention_cohort(site_id, cohort_day, day_offset, users)` for yesterday only (idempotent, resumable). Cohort definitions: first visit, first event X, signup; return event selectable.
- Page reads only `retention_cohort`. Cohort triangle with heatmap and numbers, day/week/month granularity, segment filter. Target under 200 ms is a design goal, to be measured on real data.

## 4. 1C Segments
- Reuse the existing `site_segments` table and the validated definition schema in `apps/web/src/lib/segment-schema.ts` (profile and behaviour conditions, already parameterized). The brief's "new segments table" would duplicate it; I extend it instead.
- Add a segment picker to Funnels, Retention, Journeys and Overview. Overview, Journeys and Funnels act on sessions, so a segment is compiled to a `session_hash IN (...)` fragment from identified users' sessions (via `identity_map`); this limits segments to identified users on those pages and the UI says so.
- Caps: 50 segments per site, bounded condition count (already enforced by the schema, confirm in review).

## 5. Tests, flags, docs
Per sub-feature: unit tests (fingerprint stability, scrubbing, caps), a worker-to-ClickHouse integration test run against the Aiven database like the foundation check, a tenant-isolation test (two sites, zero rows across), docs in `docs/features/errors.md`, `docs/features/retention.md`, `docs/features/segments.md`, flags `errors`, `retention`, `segments` (already in `nav.ts`).

## 6. Questions
1. Retention on identified users only (recommended), or do you want a consent-gated persistent id?
2. OK to add `source-map` (and later an S3 client) as dependencies?
3. OK to defer the alert hook to Phase 4 (P6)?
4. OK to move `web-vitals` to a lazy chunk (P7)? Vitals would load a moment after page load instead of with the core script.
5. Order: errors backend and worker first, then SDK, then UI, then 1B and 1C. Anything you want first?
