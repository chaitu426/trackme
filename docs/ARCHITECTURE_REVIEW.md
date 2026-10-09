# Architecture Review: Problems and Fix Tracker

Scope: browser SDK (`packages/tracker`), `ingest-proxy`, `ingestion-go`, Kafka, `event-worker`,
`scheduled-worker`, ClickHouse/Postgres/Redis wiring. Found by reading code, not by running it.
Not covered in depth: web app auth and dashboard pages, `packages/db` schema.

Status: `[ ]` open · `[~]` in progress · `[x]` fixed · `[?]` needs a decision first.

Severity: **P0** can stall the pipeline or leak access · **P1** loses or corrupts data · **P2** scale and cost · **P3** hygiene.

---

## P0

### P0-1 Poison event stalls the event worker `[x]`
- **Where:** `services/ingestion-go/internal/httpapi/server.go` (`validEvent`), `services/event-worker/src/worker.ts`, `services/event-worker/src/writers/clickhouse.ts`
- **Problem:** The edge checks only that `eventId` and `occurredAt` are non-empty. The worker parses both when building the ClickHouse insert. A non-UUID `eventId` or an invalid timestamp throws for the whole batch, no offset is resolved, and Kafka redelivers the same batch forever. Only unparseable JSON reaches the DLQ. The site key is public, so anyone can send this.
- **Fix:** (a) Validate UUID format, timestamp format and field lengths at the edge. (b) In the worker, validate each event, send bad ones to the DLQ with a reason, and write the rest. If a batch insert still fails, bisect to isolate the bad rows before giving up.
- **Decision made:** a bad event is dropped and the rest of the batch is accepted (`202 {processed, rejected}`); a batch with no valid events returns 400.
- **Done:** `ingestion-go/internal/validate` (mirrors the Zod schema, normalizes `occurredAt` to UTC `Z`), `event-worker/src/{contract,isolate,errors}.ts`. Tests: Go table tests, worker tests, and a fixture file (`packages/contracts/fixtures/tracker-events.json`) run by both the Go validator and the Zod schema so they cannot drift again.

### P0-2 Client-controlled timestamps `[x]`
- **Where:** `server.go`, `infra/migrations/clickhouse/001_events_raw.sql` (`PARTITION BY toYYYYMM(timestamp)`)
- **Problem:** `occurredAt` is trusted. Far-past or far-future dates create arbitrary partitions, can exceed ClickHouse's per-insert partition limit (same stall as P0-1), and can be deleted or retained wrongly.
- **Fix:** Bound `occurredAt` to a window around the server's `receivedAt`. **Decision made:** clamp to `receivedAt`; window is 24h past, 5 min future so the SDK retry queue still works offline.

### P0-3 `identify` events rejected, user fields dropped `[x]`
- **Where:** `server.go` (`validEvent`), `internal/enrich/enrich.go` (`TrackerEvent`), `packages/contracts/src/events.ts`
- **Problem:** The SDK sends `type: "identify"`, the shared schema allows it, the edge returns 400 for the whole batch. The Go struct also has no `userId` or `userTraits` fields.
- **Fix:** Accept `identify`, add the fields, and enforce the same limits as the Zod schema (see P0-1). Add a contract test that feeds the same fixtures to the Zod schema and the Go validator.
- **Done:** `identify` requires a `userId`; `userId` and `userTraits` now pass through to Kafka. The worker does not store them as columns yet; identity still reaches ClickHouse through `properties.distinctId`.

### P0-4 SDK retry queue gets stuck permanently `[x]`
- **Where:** `packages/tracker/src/transport.ts`
- **Problem:** Any non-2xx response is written to `localStorage` and replayed on every page load, including permanent 400/401/403/402. `flush()` sends the whole buffer in one request, but the edge rejects more than 50 events or 32 KB. The queue holds up to 100, so it can never drain once it passes that.
- **Fix:** Send in chunks of at most 50 events and a byte budget. Retry only network errors, 5xx and 429. Drop events after N failed attempts or an age limit. Never retry 4xx.
- **Done** (`packages/tracker/src/transport.ts`, 27 tests): chunks of at most 50 events and 30 KB; 408/429/5xx/network are retried with backoff (5 s, 15 s, 45 s, up to 5 min); other 4xx are dropped; an event is dropped after 5 attempts or 23 h; events too large to ever send are dropped alone; old-format queues still replay.

### P0-5 Spoofable client IP `[x]`
- **Where:** `server.go` (`clientIP`), `services/ingest-proxy/main.go`
- **Problem:** The leftmost `X-Forwarded-For` value is trusted, and the proxy forwards the client's own header. The per-IP rate limit and geo can be faked by rotating the header.
- **Fix:** Add a `TRUSTED_PROXY_HOPS` / trusted CIDR setting and take the address from the right. Make the proxy overwrite the header rather than forward it.
- **Decision made:** hop count (`TRUSTED_PROXY_HOPS`, default 1). **Done:** `ingestion-go/internal/clientip` takes the entry N places from the right of `X-Forwarded-For`; `X-Real-IP` is ignored; fewer entries than hops falls back to the TCP peer. The proxy now appends its peer to the chain instead of passing the client's header through. **Deployment note:** the default of 1 assumes a proxy is in front. If the edge is exposed directly set `0`; with a CDN plus load balancer set `2`. The edge logs the value it is using at startup. **Not covered:** `CF-IPCountry`-style geo headers are still trusted from the request, so they are spoofable unless your CDN overwrites them.

### P0-6 Committed session cookie and default secrets `[x]`
- **Where:** `cookie.txt`, `packages/config/src/index.ts`
- **Problem:** A real `gi_session` cookie is committed. `NEXTAUTH_SECRET` and the database and Redis passwords fall back to publicly known dev values with no production check.
- **Fix:** Delete `cookie.txt` (and add it to `.gitignore`), require secrets when `NODE_ENV=production`, and rotate any secret that was ever used with that cookie.
- **Done:** `cookie.txt` deleted and ignored. `@trackme/config` (`loadEnvironment`, 14 tests) and the Go edge (`ProductionProblems`, tests) refuse to start in production when `DATABASE_URL`, `REDIS_URL`, `CLICKHOUSE_PASSWORD` or `NEXTAUTH_SECRET` is unset or still its public default, or the session secret is under 32 characters. The check is skipped during `next build` (which also runs with `NODE_ENV=production` but has no runtime secrets).
- **You still need to do:** the cookie stays in git history. If a deployed environment ever ran on the default `NEXTAUTH_SECRET`, rotate it (this signs every session, so users are logged out) and treat that cookie as compromised. It carried an expiry of about late September 2026, so it may already have expired, which does not make the secret safe. Removing it from history needs a force-push, so I have not done it.
- **Breaking:** production processes started without those variables now exit at startup instead of running on dev credentials.

---

## P1

### P1-1 Web vitals flood the pipeline `[?]`
- **Where:** `packages/tracker/src/vitals.ts`
- **Problem:** LCP, CLS and INP emit on every observer callback, each as a counted event. Several rows per metric per view skew percentiles and use quota. Vitals are only observed once, so SPA navigations get none.
- **Fix:** Report one final value per metric per page view, on `visibilitychange`/`pagehide`, tagged with the page. **Decision needed:** whether vitals should count toward quota (proposed: no).

### P1-2 Lost events on tab close `[x]`
- **Where:** `transport.ts` (`flush`, `unloading`, `flushing`)
- **Problem:** `unloading` is reset before the async fetch failure runs, so the `sendBeacon` fallback never fires. A flush during an in-flight request returns early and leaves events only in memory. Beacons cannot carry the consent or signature headers anyway.
- **Fix:** Use `fetch` with `keepalive` and queue-on-failure synchronously. Treat `sendBeacon` as a separate path for sites with no signing or consent header. Allow a second flush while one is in flight.
- **Done:** a flush during a send is remembered and runs afterwards (and `flush()` now returns the in-flight promise). On hide: signed sites write to the retry queue (an async HMAC cannot be trusted to finish), consented sites use `fetch` keepalive (a beacon cannot carry the header), everyone else uses `sendBeacon`.

### P1-3 Consent withdrawal leaves data queued `[x]`
- **Where:** `packages/tracker/src/index.ts` (`denyConsent`), `transport.ts`
- **Problem:** Buffered and retry-queued events still flush after consent is denied.
- **Fix:** Clear the buffer and the retry queue on deny. Do not persist events to the retry queue before consent is granted.
- **Done:** deny clears buffer, queue and timers; a stored denial clears the queue at startup; with `requireConsent` the queue is held (not sent, not lost) until consent is granted.

### P1-4 Duplicate `web_vitals` rows on redelivery `[x]`
- **Where:** `services/event-worker/src/writers/clickhouse.ts`, `infra/migrations/clickhouse/003_web_vitals.sql`
- **Problem:** `events_raw` is written first, `web_vitals` second. If the second insert fails, the batch is redelivered, and `web_vitals` (plain `MergeTree`) keeps both copies.
- **Fix:** Add an `event_id` column and move the table to `ReplacingMergeTree`, or derive vitals from `events_raw` with a materialized view.
- **Done:** migration `006_web_vitals_dedupe.sql` builds a `ReplacingMergeTree` keyed on `event_id`, copies the old rows (with generated ids), and swaps the tables atomically; the old table stays as `web_vitals_old`. The worker writes `event_id` and the dashboard query reads `FINAL`. **Not run against a real ClickHouse.** It is run-once; on an existing deployment pause the worker first (steps are in the file header). Fresh volumes get it automatically after 005.

### P1-5 Tiny ClickHouse inserts `[x]`
- **Where:** `services/event-worker/src/worker.ts`, `packages/config/src/index.ts`
- **Problem:** `EVENT_BATCH_SIZE` and `EVENT_FLUSH_INTERVAL_MS` are declared but unused. One insert per Kafka poll at low volume produces too many small parts.
- **Fix:** Accumulate per partition up to a size or time threshold, or enable `async_insert` with `wait_for_async_insert=1`.
- **Done:** ClickHouse `async_insert` with `wait_for_async_insert=1`, so ClickHouse builds larger parts while the worker still waits for the flush before resolving offsets. `EVENT_FLUSH_INTERVAL_MS` now sets `async_insert_busy_timeout_ms`; `CLICKHOUSE_ASYNC_INSERT=false` turns it off. The unused `EVENT_BATCH_SIZE` setting was removed. Expect each insert to take up to that interval, which lowers per-partition throughput but not overall throughput.

### P1-6 New consumer group skips existing data `[x]`
- **Where:** `worker.ts` (`fromBeginning: false`)
- **Fix:** Use `fromBeginning: true` for the production group, and document that renaming the group replays the topic (safe because of dedupe).
- **Done.** Renaming `KAFKA_CONSUMER_GROUP` now replays the whole topic.

### P1-7 Rollups lose data after downtime or late events `[x]`
- **Where:** `services/scheduled-worker/src/jobs/hourly-rollups.ts`, `daily-rollups.ts`, SDK retry queue
- **Problem:** Fixed windows (`now() - 2h`, `today() - 1 day`). A gap in job runs, or events replayed late by the SDK, are never rolled up. Dashboards over 48 hours then undercount.
- **Fix:** Track a watermark per rollup table and recompute from the watermark minus a late-arrival allowance. **Decision needed:** allowance length (proposed: 3 days, matching the retry age limit).
- **Done, not run against ClickHouse** (`services/scheduled-worker/src/jobs/{window,daily-rollups}.ts`, 18 unit tests): each daily rollup table asks for its own newest day and recomputes from one day before it (and never less than the last `ROLLUP_LOOKBACK_DAYS`, default 2, which is enough because the edge clamps timestamps older than 24 h). A new table is seeded from the first day with events, at most `ROLLUP_BACKFILL_DAYS` (65) back, and a backlog is processed oldest first, at most `ROLLUP_MAX_DAYS_PER_RUN` (14) days per run so it cannot outlive the job lock. The job now runs every 15 minutes instead of once at 00:15, so today's numbers are at most about 15 minutes old.
- **Cost to know about:** every run scans about three days of `events_raw` per table group. Fine at modest volume; watch it as traffic grows.
- **Not changed:** the hourly job still uses a fixed 2-hour window. See the note under P2-5: nothing reads the hourly table.

### P1-8 Quota counts duplicates and bots `[?]`
- **Where:** `server.go` (`TryReserve`), `services/scheduled-worker/src/jobs/usage-metering.ts`
- **Problem:** Retried batches reserve quota again. Bot events are published and billed, then filtered out of rollups. Metering counts `events_raw` without `FINAL`, so unmerged duplicates inflate the Redis quota.
- **Fix:** Use `uniqExact(event_id)` or `FINAL` in metering. **Decision needed:** whether bot events count toward quota, or are dropped at the edge.

---

## P2 (scale, cost, availability)

### P2-1 Redis failure rejects all traffic `[x]`
- `allowIP` returns false when Redis errors. Make rate limiting fail open, log and alert on it, and serve known sites from the site cache.
- **Done:** the IP and site rate limits fail open when Redis is unreachable, and the quota check does too (`QUOTA_FAIL_OPEN`, default true; metering reconciles the real count from ClickHouse afterwards). Warnings are logged at most once per 10 s per kind. **Policy choice for you:** set `QUOTA_FAIL_OPEN=false` if you would rather reject events than risk exceeding a customer quota during a Redis outage. **Not done:** alerting; there is still no metrics endpoint (P3-5).

### P2-2 Rate limit too low for busy sites `[x]`
- IP and per-site limiters share one setting (1000 per minute). Add separate limits, with a per-site override from the workspace plan. **Decision needed:** default per-site limit.
- **Done:** separate limiter with `SITE_RATE_LIMIT_MAX`, default **10000 requests per minute per site** (about 166 per second; each request carries up to 50 events). I chose the default; change it if your largest customers need more. Per-plan overrides are not implemented.

### P2-3 Unknown site keys hit Postgres every time `[x]`
- Add a short negative cache and request coalescing (`singleflight`) in `internal/site/resolver.go`.
- **Done** (7 tests): unknown keys are remembered for 10 s in a separate, capped map so a flood of junk keys cannot evict real sites; concurrent lookups of one key share one query, run detached so a caller giving up does not fail the others; database errors are never cached; a `site:invalidate` message clears a remembered miss. The dashboard only published that on settings changes and secret rotation, not on creation, so both site-creation routes (`/api/v1/workspaces` and `/api/v1/workspaces/[id]/sites`) now publish it after saving; a brand-new key works immediately. Plan or quota changes are still not published and take up to 60 s to reach the edge.

### P2-4 Redis round trips and non-atomic counters `[~]`
- IP counter, site counter and quota are separate calls; `INCR` and `PEXPIRE` are not atomic. Combine into one Lua script or pipeline.
- **Done (atomicity):** counting and expiry are one script, and a counter already stuck without an expiry repairs itself (5 tests against an in-memory Redis). **Not done (round trips):** a request still makes three calls (IP, site, quota); the first hit of a window now costs one fewer. Merging them needs a single script across keys and is only worth it once Redis latency shows up in measurements.

### P2-5 Long-range dashboard queries scan raw events `[x]`
- `packages/analytics/src/queries/overview.ts` runs `uniqExact` over `events_raw` even in rollup mode. Store HyperLogLog or `uniqCombined` state in the rollup tables.
- **Done, not run against ClickHouse:** migration `007_daily_uniques.sql` stores per-day `uniqCombined64` states for visitors and sessions; the overview merges them (`uniqCombined64Merge`) instead of rescanning raw events. Counts are exact for small sets and within about 1% for very large ones.
- **A correctness bug found on the way:** dashboard ranges are rolling (`now - 7d .. now`), but the rollup path counted whole calendar days. A 7d view included the whole first day (up to a day too much) and left out today, and period-over-period change inherited both errors. Whole UTC days now come from the rollups and only the two partial edge days from raw events (`range-split.ts`, `buildRollupOverviewQueries`), so the raw scan is about two days whatever the range. If the rollup read fails (for example the migration is not applied yet) the overview logs a warning and answers from raw events instead of returning an error.
- **Known small approximation:** a session that starts before midnight and ends after it can be counted in both a whole day and an edge. This only affects the one midnight at each end of the range.
- **Open question for you:** the hourly rollup table (`pageview_rollups_hourly`) and the daily event table (`event_rollups_daily`) are written but nothing reads them. Keep them for planned features, or delete the jobs and tables to save the scans?

### P2-6 Per-site retention is not implemented `[?]`
- `settings.retentionMonths` is stored but the retention job, TTL and migration use the global 24 months. **Decision needed:** implement per-site retention (needs deletes or a table-per-tier design) or remove the setting.

### P2-7 Metering cost `[ ]`
- `count(*)` over the whole month every 15 minutes, then one Postgres upsert per site. Count at insert time with a materialized view, and upsert in one statement.

### P2-8 Job failures are silent, lock does not renew `[ ]`
- Record each run (start, end, rows, error) and alert on failure or staleness. Renew the lock while the job is alive.

### P2-9 Kafka key and production topology `[?]`
- Messages are keyed by `eventId`, so there is no per-session ordering. Compose runs one broker, RF 1, auto-create on. **Decision needed:** key by `siteId` or `sessionId`; production replication and partition counts.

### P2-10 Single Redis for everything `[?]`
- Rate limit, quota, sessions, realtime, locks and pub/sub share one failure domain. **Decision needed:** split into separate instances or logical groups.

### P2-11 `/tracker.js` served by the dashboard app `[?]`
- No cache headers; every customer page load hits the dashboard origin. **Decision needed:** versioned immutable file on a CDN (`TRACKER_CDN_URL`) and how existing snippets keep working.

### P2-12 CORS preflight on every send `[x]`
- Add `Access-Control-Max-Age` at the edge. Optionally use `text/plain` when no custom headers are needed.
- **Done (SDK):** requests with no signature or consent header now send `text/plain`, which the browser treats as a simple request with no preflight. **Edge:** `Access-Control-Max-Age: 86400` is now sent, so the signed and consented path preflights once a day per origin instead of every few seconds.

### P2-13 `ingest-proxy` is an open signing oracle `[x]`
- It signs any body from any caller, with no origin check, rate limit or upstream timeout. Add an origin allowlist, limits and timeouts, and a body-size cap that matches the edge.
- **Done** (`services/ingest-proxy`, 12 tests): `ALLOWED_ORIGINS` is required (`*` only for development, with a warning); refused origins are never signed; bodies over `MAX_BODY_BYTES` (32 KB) get 413 instead of being silently truncated and signed; 10 s upstream timeout; the proxy's CORS headers no longer duplicate the edge's; the preflight is cacheable for a day and does not let browsers send their own signature. The service had no `go.mod`, so it could not be built at all; added. **Not done:** a per-IP rate limit in the proxy itself (the edge already limits per client IP once `TRUSTED_PROXY_HOPS` is right).
- **Breaking:** the proxy now refuses to start without `ALLOWED_ORIGINS`.

---

## P3 (hygiene)

- **P3-1** `[ ]` Sessions are per tab and never time out (30 min inactivity). Visitor ID resets every 24h. **Decision needed** for session semantics.
- **P3-2** `[?]` No bundle size check in CI. Measured: the original bundle was 3.9 KB gzipped, so the README's "<2KB" claim was already wrong; the transport rework adds about 1.2 KB (now 5.1 KB). **Decision needed:** correct the claim and set a budget, or trim features (vitals, SPA tracking) behind separate entry points.
- **P3-3** `[ ]` `tsup` runs `clean: true` and `clean: false` in parallel; possible race on `dist`.
- **P3-4** `[ ]` `history.pushState` patch can clobber other libraries that patch it.
- **P3-5** `[ ]` Go `/health` checks nothing; no `/metrics`, no tracing in Go services.
- **P3-6** `[~]` CI now runs Go vet and tests. Web, tracker, analytics and db packages still have no tests.
- **P3-7** `[x]` Committed build output removed (`packages/config/src/index.*`, `services/ingestion-go/bin/ingestion-go`) and ignored.
- **P3-8** `[ ]` `middleware.ts` treats every `/api/*` path as public. Routes guard themselves today; make it default-deny with an allowlist.
- **P3-9** `[ ]` Remove deprecated `ingestion-node`, the `QUEUE_NAME` setting, `SPEC_EXTRACTED.txt`, `cursor_*.md`, `test.html`.
- **P3-10** `[ ]` Site signing secrets are stored in plaintext in Postgres settings. Encrypt at rest.

---

## How to verify the ClickHouse changes

Migrations 006 and 007 and the rollup SQL have only been checked by unit tests and by reading. An integration test runs them for real in a throwaway database (it never touches `growth_analytics`):

```
docker run -d --name ch-test -p 18123:8123 clickhouse/clickhouse-server:24-alpine
CLICKHOUSE_TEST_URL=http://localhost:18123 pnpm --filter @trackme/scheduled-worker test:integration
docker rm -f ch-test
```

It applies every migration in order, loads 33 days of synthetic traffic, runs the real rollup job, and checks that the 7-day and 30-day overview from rollups equals both the raw-SQL overview and a plain-JavaScript calculation. It also checks that a redelivered web vital collapses to one row, that today and the first partial day are counted exactly, that running the job twice changes nothing, and that wiping a rollup table is repaired by the next run. If it fails, the failure message names the statement.

**Deploy order:** apply migrations 006 and 007 before deploying the new worker and dashboard. The first scheduler runs backfill `daily_uniques` over several 15-minute ticks (about an hour for 65 days).

---

## Found and fixed while doing P0-1

- **Offsets were resolved out of order.** The worker resolved a dead-lettered message's offset immediately and the valid messages' offsets after the write. kafkajs treats resolving offset N as "everything up to N is done", so a crash between the two could skip valid messages. Offsets are now resolved together, in order, after the write and the DLQ publishes.
- **A failed DLQ publish was swallowed**, so the message was lost while the offset moved on. `sendToDLQ` now throws, and the batch is redelivered.
- **`@trackme/contracts` could not be imported at runtime by an ES module** (its `exports` pointed at a `dist/index.mjs` that the build never produces). It is now `"type": "module"` like the other shared packages. The worker had only imported types from it before.
- **CI never ran Go.** Added a `go-edge` job (`go vet`, `go test`). This also covers part of P3-6; package tests for web and the tracker are still missing.

## Fix order

1. P0-1, P0-3, P0-2: edge validation, shared contract, worker DLQ per event.
2. P0-4, P1-2, P1-3: SDK transport.
3. P0-5, P2-13: trusted proxy and `ingest-proxy` hardening.
4. P0-6: secrets and committed cookie.
5. P1-4 to P1-6: worker correctness.
6. P2-1 to P2-4, P2-12: edge availability and cost.
7. P1-7, P1-8, P2-5 to P2-8: rollups and metering.
8. Everything else.

Every fix lands with a test, and updates this file's status when it is merged.
