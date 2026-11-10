# Architecture Optimization Plan: Accuracy, Time and Space

Companion to `docs/architecture/ARCHITECTURE_REVIEW.md` (which tracks the P0–P3 fixes already landed). This file covers
what is still structurally wrong or wasteful after those fixes, the decision for each item, the exact
change, how to migrate to it, and how to prove it worked.

Basis: found by reading code, not by running it. Every performance claim below is a hypothesis with a
measurement attached (see §12). Do not skip the baseline measurements: several decisions
(schema, partition counts, cache TTLs) should be confirmed against real numbers before the cutover.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs a decision (§13).
Size: **S** < 1 day · **M** 1–3 days · **L** 1–2 weeks.

---

## 0. Principles and targets

Principles that drive every decision:

1. **Compute once, at insert time.** Aggregates are maintained incrementally by ClickHouse materialized
   views. No job rescans raw events to rebuild numbers it already computed.
2. **Idempotency lives at the edge, not in storage.** Duplicates are stopped before Kafka and before
   quota is charged. Storage dedupe (`ReplacingMergeTree`) is a backstop, not the mechanism.
3. **Never answer wrongly to look healthy.** A failed query is an error, not a zeroed chart. A failed
   session check closes, not opens.
4. **Bound every query.** Every dashboard query has a time, memory and rows-read limit and a cache.
5. **Every change is reversible** until the legacy tables are dropped (§11).

Targets (the acceptance bar for the whole plan):

| Area | Target | How measured |
|---|---|---|
| Ingest `POST /v1/batch` | p99 ≤ 50 ms server-side, p50 ≤ 15 ms (excluding network) | edge histogram (§10) |
| Duplicate rows in `events_v2` | ≤ 0.01 % of rows | nightly `count()` vs `uniqExact(event_id)` job |
| Dashboard overview, cache hit | p95 ≤ 100 ms | web route histogram |
| Dashboard overview, cache miss, 90 d range | p95 ≤ 800 ms | same |
| Rollup vs raw reconciliation | ≤ 0.5 % pageviews, ≤ 2 % uniques (HLL error) | nightly job (§7.5) |
| ClickHouse active parts per partition | < 300 (alert at 200) | `system.parts` |
| Kafka consumer lag | < 10 s at steady state | consumer lag metric |
| Storage per 1 M events | ≥ 30 % smaller than `events_raw` (hypothesis) | `system.parts` before/after (§12) |
| Revoked session still accepted | 0 requests after revocation (≤ 1 s propagation) | integration test |

---

## 1. Issue register and where each is solved

| ID | Issue | Class | Workstream | Size |
|---|---|---|---|---|
| A1 [~] | Dashboard reads raw table without dedupe; duplicate rows inflate counts | Accuracy | WS1, WS3 | L |
| A2 [~] | Retried clamped event gets a new timestamp, so dedupe key changes and never collapses | Accuracy | WS1 | M |
| A3 [x] | `revokeAllUserSessions` does not touch the Redis cache; DB error fails open | Security | WS5 | M |
| A4 [x] | Funnel query returns zeros when ClickHouse fails | Accuracy | WS4 | S |
| A5 [~] | Quota counts bots and retried batches; partial Kafka write is released as a whole | Accuracy | WS1, WS6 | M |
| A6 [x] | Quota value taken from an arbitrary site in the workspace (`firstSiteForWorkspace`) | Accuracy | WS6 | S |
| T1 | Rollup jobs rescan ~3 days of raw events per table every 15 min, across all tenants | Time/cost | WS3 | L |
| T2 | Filtered queries and all breakdowns bypass rollups and scan raw | Time | WS3, WS4 | M |
| T3 [~] | No result cache; every dashboard load and auto-refresh hits ClickHouse + Postgres | Time | WS4 | M |
| T4 [~] | Edge does several sequential Redis round trips; 10 ms Kafka linger on a sync path; gzip | Time | WS6 | M |
| T5 [~] | Worker throughput limited by per-batch wait on `async_insert` | Time | WS7 | M |
| T6 [x] | Realtime: 4 Redis commands per event; every web node receives every site's notifications | Time | WS8 | S |
| T7 [x] | Funnel scans every event in range instead of only step-matching events | Time | WS4 | S |
| S1 | `event_id` last in sort key; String ids; no codecs; full `url` + `path` | Space | WS2 | L |
| S2 | `properties_json` parsed at query time (`JSONExtractString`) | Space/Time | WS2 | S |
| S3 | Rollup dimension key too wide to reduce rows (full referrer URL × 8 dims) | Space | WS2, WS3 | M |
| S4 | Kafka payload repeats tenant fields per event; gzip | Space | WS6 | S |
| S5 | Two unused rollup tables are still computed and stored | Space/Time | WS3 | S |
| O1 [~] | `/metrics` serves expvar JSON under a Prometheus content type; no histograms | Ops | WS9 | M |
| O2 [x] | `docs/architecture/ARCHITECTURE_REVIEW.md` P2-9 is stale (Kafka key is already `siteId:sessionId`) | Docs | WS9 | S |

---

## 2. Target architecture

```
Browser SDK ──► ingest-proxy ──► ingestion-go (edge)
                                   │  1. validate/clamp (existing)
                                   │  2. ONE Redis script: ip limit + site limit
                                   │     + claim event_ids (dedupe) + reserve quota
                                   │  3. publish (zstd, small linger)
                                   │  4. confirm claims (long TTL) / release on failure
                                   ▼
                                 Kafka  (key = siteId:sessionId)
                                   ▼
                              event-worker
                                   │  large sync inserts, deterministic dedupe token
                                   ├──► ClickHouse  events_v2 ──MVs──► *_agg tables
                                   └──► Redis realtime (batched per site)
                                   ▼
          scheduled-worker: retention, metering, reconciliation, dup-rate check ONLY
                                   ▼
Next.js API ──► authz cache ──► query cache (singleflight) ──► ClickHouse (read-only profile, limits)
```

What disappears: hourly/daily rollup jobs and their watermark logic, `FINAL` on rollup reads, the second
`web_vitals` insert, per-event realtime Redis writes, Redis `psubscribe("rt:notify:*")`.

---

## WS1. Event identity and deduplication (A1, A2, A5)

### Problem
- Duplicates enter by two routes: (a) the SDK retries after a response it never saw (new Kafka messages,
  same `eventId`), (b) the worker re-reads a batch after a crash (same messages).
- Today `ReplacingMergeTree` ordered by `(…, toDate(timestamp), …, event_id)` only collapses rows whose
  date part matches. When the edge clamps an out-of-window `occurredAt` to `receivedAt`, each retry gets a
  different timestamp, so copies never merge.
- Dashboards read `events_raw` without `FINAL`, so copies are counted until a background merge happens
  (and may never merge if the keys differ).
- Quota is charged for every retry.

### Decision
Three layers, cheapest first:

1. **Edge claim (primary).** The edge atomically claims each `eventId` in Redis before publishing. An
   already-claimed id is silently dropped from the batch (still counted in the `processed` response so the
   SDK stops retrying). Dropped duplicates are not quota-charged.
2. **Worker insert token (crash replay).** The worker inserts each Kafka batch with
   `insert_deduplication_token = <topic>:<partition>:<firstOffset>:<lastOffset>`, and the table keeps
   `non_replicated_deduplication_window`. A byte-identical replay is dropped by ClickHouse.
3. **Measured backstop.** A nightly job computes duplicate rate per day. If above the 0.01 % target, it runs
   `OPTIMIZE TABLE events_v2 PARTITION <month> FINAL DEDUPLICATE BY site_id, event_id` for the affected month
   (rare, off-peak).

Layer 2 is honest about its limit: after a crash the consumer resumes at the last committed offset, so batch
boundaries may differ and the token will differ. That residual is what layer 3 measures and bounds.

Because the new sort key no longer contains `event_id` (WS2), `ReplacingMergeTree` is **not** used for
`events_v2`.

### Claim protocol (edge) — avoids losing events on failure
A naïve `SET NX` before publishing loses data: if publish fails, the SDK retry is treated as a duplicate.

```
claim:   SET evt:{eventId} "p" NX EX 120        -- "pending", short
publish: Kafka write
ok:      EXPIRE evt:{eventId} 90000             -- 25 h (SDK retry age limit is 23 h)
fail:    DEL evt:{eventId}  (for ids this request claimed) ; DECRBY quota
crash between claim and publish: the 120 s pending TTL expires, a retry is then accepted.
```

Single Lua script, `KEYS` = rate/quota keys then event keys (single Redis instance; if Redis ever becomes a
cluster, hash-tag all keys of one request with the site id):

```lua
-- ARGV: ip_limit, site_limit, window_ms, quota, ttl, n_events
-- KEYS: [1]=ip, [2]=site, [3]=quota, [4..]=evt keys
-- returns: {status, newly_claimed_bitmask_or_list, quota_after}
-- status: 0 ok, 1 ip limited, 2 site limited, 3 quota exceeded
```

Order inside the script: IP limit → site limit → claim ids → reserve quota for **claimed count only** →
return which ids were claimed. If quota is exceeded the script un-claims what it just claimed before
returning (it is all one atomic script).

### Changes
- `services/ingestion-go/internal/dedupe/` (new): `Claim`, `Confirm`, `Release` wrapping the script.
- `server.go processEvents`: replace the three separate limiter/quota calls with one `Gate.Admit(ctx, req)`
  returning `{status, admittedEvents}`; publish only admitted events; call `Confirm` on success or
  `Release` on failure.
- Response body adds `duplicates` so the SDK/logs can tell drop-as-duplicate from reject.
- Worker (`clickhouse.ts`): pass `insert_deduplication_token` in `clickhouse_settings` and **disable
  `async_insert`** for the main path (token dedupe applies to sync inserts of identical blocks; async inserts
  need `async_insert_deduplicate=1` and give weaker guarantees). WS7 makes inserts large enough that this is
  fine.
- Metrics: `edge_events_total{outcome="duplicate"}`, `edge_redis_errors_total{op="dedupe"}`.

**Progress:** the Go edge now has an opt-in `EDGE_DEDUPE` implementation. It claims event IDs in Redis
before quota reservation, confirms successfully published IDs for 25 hours, and releases claims and the
corresponding reserved quota for failed publishes. Per-message `kafka.WriteErrors` results preserve claims
only for messages known to have succeeded. Ambiguous Kafka errors release the full batch so the SDK can retry;
that can produce a duplicate and remains covered by the worker/storage backstop. Redis claim failures fail
open and are counted. The flag defaults off for staged rollout. The ClickHouse v2 migration/read cutover,
worker insert token, and combined one-RTT gate are not part of this change, so A1/A2/A5 remain in progress.

### Redis failure policy
If the claim script errors, fail **open** (accept, publish, no claim) and increment
`edge_dedupe_redis_errors_total`. Layers 2–3 bound the damage. This keeps P2-1's rule that Redis outage must
not stop ingestion.

### Tests / done when
- Go unit tests with an in-memory Redis (pattern already used for the limiter): double submit → one publish;
  publish failure → claims released, retry accepted; quota exceeded → no claims left behind; Redis error →
  accepted.
- Worker test: same offsets replayed → token identical.
- Chaos test: kill the worker mid-batch 50 times under load; measure duplicate rate; must be ≤ target.
- Done when duplicate rate in the nightly job is ≤ 0.01 % over 7 consecutive days.

---

## WS2. ClickHouse schema v2: `events_v2` (S1, S2, S3)

### Decisions
| Decision | Choice | Reason |
|---|---|---|
| Engine | plain `MergeTree` | dedupe handled by WS1; removes `FINAL` and merge-time dependence |
| Sort key | `(site_id, toDate(timestamp), type, event_name, session_hash, timestamp)` | matches every dashboard filter (site + date range + type); `session_hash` makes funnels/sessions group in key order (`optimize_aggregation_in_order`) |
| `workspace_id` | kept as a column, **not** in the key | implied by `site_id`; still used for metering and defense-in-depth filter |
| `session_id`, `visitor_pseudonym` | stored as `UInt64` hashes (`cityHash64`) | 36-byte strings → 8 bytes; only equality/distinct needed. **Pre-work:** grep queries for any place that returns the raw id to a UI (user timeline, people). If one exists keep the string for that column |
| `url` | dropped; keep `path`, add `host` only if needed | `url` is `host + path + query` already stored in parts; query strings were already sanitized by the edge |
| `referrer` | keep full (ZSTD) **and** add `referrer_domain` | rollups/breakdowns use the domain, which has far lower cardinality |
| `country` | `LowCardinality(String)` storing `''` when unknown | removes the `"  "` FixedString placeholder hack |
| Hot JSON keys | `MATERIALIZED` columns (`goal`) | funnels/goals stop parsing JSON per row |
| Web vitals | columns on `events_v2` + MV (WS3), no second insert | removes the dual write (P1-4 root cause) |
| Codecs | `DoubleDelta,ZSTD(1)` on timestamps; `ZSTD(3)` on long strings | cheap size win |
| Retention | same 24-month TTL, `ttl_only_drop_parts=1` | per-site retention stays out of scope (§13) |

### DDL: `infra/migrations/clickhouse/008_events_v2.sql`

```sql
CREATE TABLE IF NOT EXISTS growth_analytics.events_v2
(
    event_id          UUID,
    site_id           UUID,
    workspace_id      UUID,
    schema_version    UInt8 DEFAULT 2,

    timestamp         DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    received_at       DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),

    type              LowCardinality(String),
    event_name        LowCardinality(String),

    session_hash      UInt64,
    visitor_hash      UInt64,

    path              String CODEC(ZSTD(3)),
    title             String CODEC(ZSTD(3)),
    referrer          String CODEC(ZSTD(3)),
    referrer_domain   LowCardinality(String) MATERIALIZED domainWithoutWWW(referrer),

    campaign_source   LowCardinality(String),
    campaign_medium   LowCardinality(String),
    campaign_name     LowCardinality(String),
    campaign_term     LowCardinality(String),
    campaign_content  LowCardinality(String),

    country           LowCardinality(String),
    city              LowCardinality(String),
    browser           LowCardinality(String),
    os                LowCardinality(String),
    device            LowCardinality(String),
    bot_status        LowCardinality(String),

    vital_name        LowCardinality(String) DEFAULT '',
    vital_value       Float64 DEFAULT 0,
    vital_rating      LowCardinality(String) DEFAULT '',
    vital_nav_type    LowCardinality(String) DEFAULT '',

    properties_json   String CODEC(ZSTD(3)),
    goal              LowCardinality(String) MATERIALIZED JSONExtractString(properties_json, 'goal')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
PRIMARY KEY (site_id, toDate(timestamp), type, event_name)
ORDER BY (site_id, toDate(timestamp), type, event_name, session_hash, timestamp)
TTL toDateTime(timestamp) + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1,
         non_replicated_deduplication_window = 1000,
         index_granularity = 8192;
```

Note `city` becomes `LowCardinality` (bounded set per country); if the GeoIP database yields more than ~100k
distinct values per partition, change back to `String CODEC(ZSTD(3))` after measuring.

### Hash definition (must match everywhere)
`session_hash = cityHash64(session_id_string)`, `visitor_hash = cityHash64(visitor_pseudonym)` computed in the
**worker** (JS cannot compute CityHash64 cheaply and consistently) — so the decision is to compute it in
ClickHouse instead: the worker inserts the strings into a `Null`-engine staging table
`events_ingest` whose MV into `events_v2` applies `cityHash64(...)`. This keeps one hash implementation and
the worker code simple.

```sql
CREATE TABLE growth_analytics.events_ingest (/* same columns as the old events_raw, session_id String, visitor_pseudonym String, url String … */)
ENGINE = Null;

CREATE MATERIALIZED VIEW growth_analytics.mv_events_ingest TO growth_analytics.events_v2 AS
SELECT event_id, site_id, workspace_id, timestamp, received_at, type, event_name,
       cityHash64(session_id) AS session_hash, cityHash64(visitor_pseudonym) AS visitor_hash,
       path, title, referrer, campaign_source, campaign_medium, campaign_name, campaign_term, campaign_content,
       country, city, browser, os, device, bot_status,
       vital_name, vital_value, vital_rating, vital_nav_type, properties_json
FROM growth_analytics.events_ingest;
```

The worker's insert target becomes `events_ingest`; adding a column later never touches the hot table.

### Tests / done when
- Migration applies on a fresh volume and on a populated one in the integration test.
- `system.columns` compressed size per column recorded before/after (§12); target ≥ 30 % smaller per million rows.
- `EXPLAIN indexes = 1` on the overview, breakdown and funnel queries shows primary-key pruning to the site+date range.

---

## WS3. Incremental aggregates via materialized views (A1, T1, T2, S3, S5)

### Problem
Jobs recompute `GROUP BY … uniqExact` over ~3 days of raw events every 15 minutes, for every tenant, per
table. Cost grows with total traffic even if nothing changed, and the late-arrival logic (`window.ts`,
watermarks, lookback, backfill caps, locks) exists only to imitate what an aggregating table does natively.

### Decision
Replace the jobs with `AggregatingMergeTree` tables fed by MVs on `events_v2`. Reads never use `FINAL`:
they re-aggregate (`sum`, `uniqCombined64Merge`, …), which is correct before and after merges.

Semantics to keep identical to today (so the shadow compare in §11 is meaningful): human traffic only
(`bot_status = 'human'`), visitors/sessions are distinct counts merged from states (never summed across days),
UTC days. Open item: whether `web_vital` events should count toward visitors/pageviews (today they count
toward uniques) — default is **keep current behavior**, decide separately (§13).

### DDL: `009_aggregates.sql`

```sql
-- 1) Site totals per day
CREATE TABLE growth_analytics.site_daily_agg
(
    site_id      UUID,
    workspace_id UUID,
    date         Date,
    pageviews SimpleAggregateFunction(sum, UInt64),
    events    SimpleAggregateFunction(sum, UInt64),
    visitors  AggregateFunction(uniqCombined64, UInt64),
    sessions  AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date) ORDER BY (site_id, workspace_id, date)
TTL date + INTERVAL 24 MONTH DELETE SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW growth_analytics.mv_site_daily TO growth_analytics.site_daily_agg AS
SELECT site_id, workspace_id, toDate(timestamp) AS date,
       toUInt64(countIf(type = 'pageview')) AS pageviews,
       toUInt64(count())                    AS events,
       uniqCombined64State(visitor_hash)    AS visitors,
       uniqCombined64State(session_hash)    AS sessions
FROM growth_analytics.events_v2
WHERE bot_status = 'human'
GROUP BY site_id, workspace_id, date;

-- 2) Sessions per day (for bounce rate and duration)
CREATE TABLE growth_analytics.session_day_agg
(
    site_id      UUID,
    date         Date,
    session_hash UInt64,
    first_ts     SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_ts      SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    pageviews    SimpleAggregateFunction(sum, UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date) ORDER BY (site_id, date, session_hash)
TTL date + INTERVAL 24 MONTH DELETE SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW growth_analytics.mv_session_day TO growth_analytics.session_day_agg AS
SELECT site_id, toDate(timestamp) AS date, session_hash,
       min(timestamp) AS first_ts, max(timestamp) AS last_ts,
       toUInt32(countIf(type = 'pageview')) AS pageviews
FROM growth_analytics.events_v2
WHERE bot_status = 'human'
GROUP BY site_id, date, session_hash;
```

`session_day_agg` key includes the **event's** date (stable at insert time), so a session crossing midnight has
two rows; engagement queries group by `session_hash` over `[from-1d, to+1d]` and attribute the session to the
day of its `min(first_ts)` — the same rule the current `ENGAGEMENT_SQL` uses. This table has one row per
session-day (roughly 5–20× fewer rows than events), so engagement for 90 days reads a small table.

```sql
-- 3) One table for all single-dimension breakdowns
CREATE TABLE growth_analytics.dim_daily_agg
(
    site_id   UUID,
    date      Date,
    dim       LowCardinality(String),
    value     String,
    pageviews SimpleAggregateFunction(sum, UInt64),
    visitors  AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date) ORDER BY (site_id, dim, date, value)
TTL date + INTERVAL 24 MONTH DELETE SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW growth_analytics.mv_dim_daily TO growth_analytics.dim_daily_agg AS
SELECT site_id, toDate(timestamp) AS date, d.1 AS dim, d.2 AS value,
       toUInt64(countIf(type = 'pageview')) AS pageviews,
       uniqCombined64State(visitor_hash)    AS visitors
FROM growth_analytics.events_v2
ARRAY JOIN [
    ('path', path), ('referrer', referrer_domain), ('country', country),
    ('browser', browser), ('os', os), ('device', device),
    ('source', campaign_source), ('medium', campaign_medium), ('campaign', campaign_name)
] AS d
WHERE bot_status = 'human'
GROUP BY site_id, date, dim, value;

-- 4) Wide table for the (rare) multi-filter queries: referrer reduced to domain
CREATE TABLE growth_analytics.filter_daily_agg
(
    site_id UUID, date Date,
    path String, referrer_domain LowCardinality(String), country LowCardinality(String),
    browser LowCardinality(String), os LowCardinality(String), device LowCardinality(String),
    campaign_source LowCardinality(String), campaign_medium LowCardinality(String), campaign_name LowCardinality(String),
    pageviews SimpleAggregateFunction(sum, UInt64),
    visitors  AggregateFunction(uniqCombined64, UInt64),
    sessions  AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, path, referrer_domain, country, browser, os, device, campaign_source, campaign_medium, campaign_name)
TTL date + INTERVAL 24 MONTH DELETE SETTINGS ttl_only_drop_parts = 1;
-- MV mv_filter_daily: same pattern as mv_site_daily, grouped by all dimension columns.

-- 5) Custom events per day
CREATE TABLE growth_analytics.event_daily_agg
(
    site_id UUID, date Date, event_name LowCardinality(String),
    total_count SimpleAggregateFunction(sum, UInt64),
    sessions AggregateFunction(uniqCombined64, UInt64),
    visitors AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(date) ORDER BY (site_id, date, event_name)
TTL date + INTERVAL 24 MONTH DELETE SETTINGS ttl_only_drop_parts = 1;
-- MV mv_event_daily: WHERE type = 'custom' AND bot_status = 'human'

-- 6) Web vitals (replaces the second insert and FINAL)
CREATE TABLE growth_analytics.web_vitals_agg
(
    site_id UUID, date Date, path String, metric LowCardinality(String),
    samples SimpleAggregateFunction(sum, UInt64),
    good    SimpleAggregateFunction(sum, UInt64),
    needs   SimpleAggregateFunction(sum, UInt64),
    poor    SimpleAggregateFunction(sum, UInt64),
    q       AggregateFunction(quantilesTDigest(0.5, 0.75, 0.95), Float64)
)
ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(date) ORDER BY (site_id, date, metric, path)
TTL date + INTERVAL 24 MONTH DELETE SETTINGS ttl_only_drop_parts = 1;
-- MV mv_web_vitals: WHERE type = 'web_vital'; quantilesTDigestState(0.5,0.75,0.95)(vital_value), sumIf on vital_rating
```

Path cardinality: raw `path` can contain ids (`/orders/123`). The edge already strips queries; add a
**path normalizer** (numeric and UUID segments → `:id`) behind a site setting as a follow-up. Until then the
`dim = 'path'` rows are bounded by a read-time `LIMIT`, and the table's size is watched (§10, alert on rows per
site-day).

### Read-path changes (`packages/analytics`)
| Query | New source |
|---|---|
| Overview ≤ 48 h, unfiltered | `events_v2` (small range, key-pruned) |
| Overview > 48 h, unfiltered | `site_daily_agg` (whole days) + `session_day_agg` + edge days from `events_v2` — same `range-split.ts` logic, new tables |
| Overview with filters | `filter_daily_agg` for whole days + `events_v2` edge days |
| Breakdowns, no filters | `dim_daily_agg WHERE dim = {dim}` (whole days) + edge days |
| Breakdowns with filters | `filter_daily_agg`, grouped by the requested column |
| Custom events / goals | `event_daily_agg` (+ `events_v2` for goal path rules) |
| Web vitals | `web_vitals_agg` with `quantilesTDigestMerge` |
| Funnels, journeys, timelines, recent events, realtime verification | `events_v2` (need event-level data) |

Example overview read (replaces `daily_uniques FINAL` etc.):

```sql
SELECT sum(pageviews) AS pageviews,
       uniqCombined64Merge(visitors) AS visitors,
       uniqCombined64Merge(sessions) AS sessions
FROM growth_analytics.site_daily_agg
WHERE site_id = {siteId:UUID} AND date >= {fullFrom:Date} AND date < {fullTo:Date}
```

Distinct counts across the whole days and the two edge days must be merged as **states** in one query
(`UNION ALL` of states then `uniqCombined64Merge`) exactly as `buildRollupOverviewQueries` does today. Do not
add visitors from separate queries.

### Decommission (after cutover, §11)
Drop `pageview_rollups_hourly`, `pageview_rollups_daily`, `event_rollups_daily`, `daily_uniques`,
`session_engagement_daily`, `events_raw`, `web_vitals` (renamed to `*_old` first). Delete
`hourly-rollups.ts`, `daily-rollups.ts`, `window.ts` and their tests; keep `usage-metering.ts`,
`retention.ts` and the lock. Metering reads `site_daily_agg` summed by `workspace_id`, which is
 denormalized into `site_daily_agg` (one site belongs to one workspace; see DDL).

### 7.5 Reconciliation (guards against MV drift)
Nightly job: for yesterday and for 7 days ago, per site, compare `site_daily_agg` against a raw
`events_v2` aggregate. Alert when pageviews differ > 0.5 % or visitors > 2 %. Backfill any day by
re-running the MV's `SELECT` as an `INSERT` for a **new, empty** shadow table and swapping partitions
(`ALTER TABLE … REPLACE PARTITION`) — never insert a second copy into a live aggregate (it would double
`sum` columns).

### Tests / done when
- Extend `rollups.integration.test.ts`: insert synthetic traffic into `events_ingest`, assert every read path
  equals both raw SQL and a plain-JS calculation (the same oracle approach used today), including: late
  events, a session crossing midnight, bots, filtered ranges, 7/30/90-day ranges, duplicates removed by WS1.
- Scan-size test: `system.query_log.read_rows` for a 90-day overview ≤ (2 days of raw + O(days) aggregate rows).

---

## WS4. Query layer: caching, limits, correctness (A4, T2, T3, T7)

### 4.1 Result cache with single-flight
New `packages/analytics/src/cache.ts`:

```ts
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = await redisGet(key);                       // cache role redis (not the quota/session one)
  if (hit) return JSON.parse(hit) as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;             // coalesce identical concurrent queries
  const p = fn().then(async (v) => { await redisSet(key, JSON.stringify(v), ttlSec); return v; })
                .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
```

Key = `q:v1:{endpoint}:{siteId}:{sha1(normalizedRequest)}`. **Normalize the range** before hashing and
before querying, otherwise a rolling `now` makes every key unique:
- ranges ≤ 48 h: floor `from`/`to` to the minute;
- ranges > 48 h: floor to 5 minutes.

TTL: range ends within the last 5 min → 30 s; otherwise 15 min. The auto-refresh component then costs one
ClickHouse query per site per 30 s regardless of open tabs. Add stale-while-revalidate (serve the expired
value once while one request refreshes) if the p95 target needs it.

Tenancy: the site id is in the key and the route authorizes **before** the cache lookup, so a cache hit
never skips authorization.

### 4.2 Authorization cache
`requireMetricsAccess` runs a Postgres query on every request. Cache:
- membership + role: `authz:{userId}:{workspaceId}` for 30 s, invalidated by a `authz:invalidate` pub/sub
  message on member removal/role change (same mechanism as `site:invalidate`);
- site-belongs-to-workspace: `sitews:{siteId}` for 10 min (changes only on delete/move).

### 4.3 Read-only profile and limits
Create a separate ClickHouse user for the web app:

```sql
CREATE SETTINGS PROFILE dashboard_ro SETTINGS
    readonly = 1, max_execution_time = 10, max_memory_usage = 2000000000,
    max_rows_to_read = 500000000, max_result_rows = 100000,
    max_bytes_before_external_group_by = 1000000000,
    max_concurrent_queries_for_user = 20;
CREATE USER dashboard_ro IDENTIFIED BY '…' SETTINGS PROFILE 'dashboard_ro';
GRANT SELECT ON growth_analytics.* TO dashboard_ro;
```

Values are starting points; set them from the p99 of real queries. The worker and scheduled-worker keep
their own write users. `CLICKHOUSE_DASHBOARD_USER/PASSWORD` become new env vars (validated by
`@trackme/config`; required in production).

### 4.4 Funnel correctness and speed (A4, T7)
- Remove the `catch` that returns zeroed steps. Throw a typed `AnalyticsQueryError`; the route returns
  `502 {"error":{"code":"ANALYTICS_UNAVAILABLE"}}`; the UI shows a retry state. Never cache an error.
- Add a pre-filter so ClickHouse only reads events relevant to some step:

```sql
WHERE site_id = {siteId:UUID} AND timestamp >= … AND timestamp <= …
  AND bot_status = 'human'
  AND ( (type='pageview' AND startsWith(path, {step_0:String})) OR (type='custom' AND event_name = {step_1:String}) … )
SETTINGS optimize_aggregation_in_order = 1
```

  `windowFunnel` ignores events matching no condition, so results are identical but the scanned set is small.
  Use `startsWith` instead of `LIKE concat(x,'%')` so a path containing `%` or `_` is not treated as a pattern.
- Cache funnel results with the §4.1 helper (TTL 5 min; funnels are not "live").

### 4.5 Raw-scan guard for filtered queries
Filtered queries use `filter_daily_agg` (§WS3), so the raw fallback is only for the two edge days. If a
query nevertheless must scan raw over more than 31 days (for example a goal with a path rule), reject with
`422 RANGE_TOO_WIDE` instead of running it unbounded.

**Progress:** 4.1 is implemented for the overview and breakdown routes (`apps/web/src/lib/query-cache.ts`):
single-flight, cache role Redis, key `q:v1:{endpoint}:{siteId}:{sha1}`, rolling ranges floored to 1 min (≤ 48 h) or
5 min, TTL 30 s for live ranges and 15 min otherwise, errors never cached, Redis outage degrades to a direct query.
Ranges that end in the past are **not** floored (flooring `to` would drop the tail of a closed day). Funnels
(`cachedFunnel`, 5 min TTL, key covers the steps) are cached too; time-series and people routes are not yet. 4.2 is implemented (`authz-cache.ts`): membership 30 s and
site-in-workspace 10 min, positives only, used by `requireMetricsAccess` only; mutation routes still read Postgres.
Invalidation is a direct `DEL` on member role change/removal/ownership transfer and site delete (all web nodes share
the cache Redis, so no pub/sub is needed). 4.3 is implemented: dashboard queries use
`getDashboardClickHouseClient()` with `CLICKHOUSE_DASHBOARD_USER/PASSWORD`, which **must be set in production** (the
client throws otherwise; development falls back to the main user). The profile is `infra/ops/clickhouse-dashboard-ro.sql`
and uses `readonly = 2`, not `1`: the HTTP client sends per-query settings, which `readonly = 1` rejects. It is run by
an admin per environment rather than auto-applied, so no password lives in the repo. 4.5 is open (the funnel range
guard already exists).

### Done when
- p95 targets in §0 met in a load test with 50 concurrent dashboards on one site.
- Killing ClickHouse makes funnel/overview routes return 502, not zeros (test).
- Authorization still enforced on a cache hit (test: user without access gets 403 on a warm key).

---

## WS5. Sessions and authentication (A3)

### Problem
`validateRegisteredSession` returns valid on any Redis hit. `revokeAllUserSessions` updates only Postgres, so
revoked sessions stay valid until the Redis TTL (up to 30 days). If Postgres errors, the function falls back
to trusting the token signature. `createRegisteredSession` logs and continues when the DB insert fails, so a
session can exist only in Redis and vanish on a Redis flush.

### Decision
Add a per-user "valid after" marker and fail closed.

1. Token payload gains `iat` (issued-at, seconds). Tokens without `iat` are treated as `iat = 0`.
2. `users.sessions_valid_after timestamptz NOT NULL DEFAULT 'epoch'` (Drizzle migration `0002_*`), mirrored in
   Redis as `user:sva:{userId}` (no TTL; repopulated from Postgres on miss).
3. `revokeAllUserSessions(userId)`: in one transaction set the Postgres column to `now()`, mark session rows
   revoked, then `SET user:sva:{userId}`. Order: Postgres first (authoritative), then Redis.
4. `validateRegisteredSession`: one Redis `MGET session:{hash} user:sva:{userId}`.
   - session key says revoked → reject;
   - `payload.iat < sva` → reject;
   - session key hit and marker present or absent-but-confirmed-epoch → accept.
   - Redis miss → Postgres check of the session row **and** `sessions_valid_after`; on success repopulate both
     keys.
   - Postgres error **and** Redis miss → **reject** (fail closed, `503` from API routes, redirect to login
     from middleware). A Redis hit with a Postgres outage is still served (the marker was just read from Redis).
5. `createRegisteredSession`: the DB insert is mandatory. If it fails, the login fails with 503. Redis write
   failure is tolerated (Postgres is authoritative).
6. Middleware (edge runtime) keeps doing only the signature/expiry check; the revocation check stays in the
   Node route layer (`requireAuth`). Document that middleware alone is not authoritative.

### Tests / done when
- Integration: login on two devices → `revokeAllUserSessions` → both tokens rejected on the very next call,
  with Redis warm and with Redis flushed.
- Postgres down + Redis miss → 503; Postgres down + Redis hit → 200.
- Existing sessions without `iat` keep working until the first revoke-all (then are rejected, which is the
  safe direction).

---

## WS6. Edge hot path and quota (T4, S4, A5, A6)

### 6.1 One Redis round trip
Replace `allowIP` + site limiter + `TryReserve` with the single script from WS1 (`Gate.Admit`). Fixed-window
counters stay (simple and cheap); the script does `INCR` + `PEXPIRE` only when the counter is new.
Result: 1 Redis RTT per request instead of 3 (and 0 extra for the dedupe claims).

### 6.2 Quota
- `MonthlyEventQuota` must come from the **workspace** row, not the site row. Change `site/resolver.go`'s SQL to
  join `workspaces` and return one quota per workspace; delete `firstSiteForWorkspace`.
- Bots: **known bots (UA match) are dropped at the edge** (not published, not stored, not billed) and counted in
  `edge_events_dropped_total{reason="bot"}`. Heuristic bots are stored with `bot_status='heuristic_bot'` and are
  **not** charged (the script reserves `delta` for non-bot events only). Rationale: customers should not pay for
  crawlers, and dropped crawlers are the cheapest rows to avoid.
- Duplicates are not charged (WS1).
- Publish failure releases the claims and the reservation for exactly the events of this request. With
  `kafka-go`, a `WriteMessages` error can mean *some* messages were written; the release path therefore leaves
  the **claims** in place for events the writer reports as written (inspect `kafka.WriteErrors`) and
  releases only the rest, so the SDK retry of the whole batch dedupes the written part instead of duplicating
  it.
- Metering (`usage-metering.ts`) keeps reconciling from ClickHouse (`site_daily_agg.events` summed per
  workspace); the Redis counter is the fast gate, ClickHouse is truth.

### 6.3 Kafka producer
```go
&kafka.Writer{
    Addr: kafka.TCP(brokers...), Topic: topic, Balancer: &kafka.Hash{},
    RequiredAcks: kafka.RequireAll, Async: false,
    BatchSize: 500, BatchBytes: 4 << 20, BatchTimeout: 2 * time.Millisecond,
    Compression: kafka.Zstd,
}
```
- `BatchTimeout` 10 ms → 2 ms: the synchronous handler no longer pays up to 10 ms on every call; concurrent
  requests still share batches.
- zstd instead of gzip: lower CPU, better ratio on repeated JSON keys. This also resolves S4: compression is
  per record batch, so the repeated `workspaceId`/`siteKey`/field names compress to almost nothing; switching to
  Protobuf is **not** required for space and is deferred (revisit only if broker network/disk is the bottleneck).
- Requires brokers ≥ 2.1 (zstd). Check before rollout; fall back to `Snappy` otherwise.
- Marshal once per event into a pooled buffer (`sync.Pool`) to cut allocations in `Publish`.

### 6.4 Partition sizing (decision, was P2-9)
Topic partitions ≥ 3× the number of worker replicas you expect at peak, minimum 12. Key stays
`siteId:sessionId` (already implemented; per-session order is preserved, one huge site spreads across
partitions). Production topic: replication factor 3, `min.insync.replicas=2`, `auto.create.topics.enable=false`.
Compose stays single-broker for dev.

**Progress (6.3):** the producer now uses zstd (`KAFKA_COMPRESSION`, default `zstd`; `snappy`/`lz4`/`gzip`/`none`
accepted for older brokers, unknown values fail at startup), `BatchTimeout` 2 ms, `BatchSize` 500, `BatchBytes` 4 MiB,
and marshals through a pooled buffer. 6.1 (single Redis round trip) and the 6.2 bot-billing items are not part of
this change.

**Progress (6.1):** `internal/gate` runs the IP limit, site rate limit, event-ID claims and quota reservation as one
atomic script (flag `EDGE_GATE_SCRIPT`, now default on). A request therefore costs 2 Redis round trips (fused gate,
confirm) instead of 4+ (IP, site limit, claim, one quota call per workspace, confirm), and the IP counter is keyed
the same way as before so limits are unchanged. Quota is reserved for claimed, human events only, and a quota
rejection undoes the claims the same script made, so a retry is never dropped as a duplicate. Redis errors follow
`ADMISSION_FAIL_CLOSED` (default on: `503`), with `QUOTA_FAIL_OPEN=false` as the compatible fallback. Tested on an
in-memory Redis at script and handler level.

### Done when
- Load test (vegeta/k6, 50-event batches at the per-site limit): p99 ≤ 50 ms with Redis RTT 1 ms.
- Redis `COMMANDSTATS` show 1 script call per request.
- Test: crawler UA batch is not published and not charged; partial Kafka write leaves claims for written events.

---

## WS7. Event worker throughput (T5)

### Problem
Each `eachBatch` call inserts what one fetch returned (≤ 1 MB per partition) and, with `async_insert` +
`wait_for_async_insert`, waits up to the flush interval. One partition therefore tops out near
`rows_per_batch / interval`. Many small inserts also create many parts.

### Decision
Make batches big by configuration, then insert synchronously.

```ts
const consumer = kafka.consumer({
  groupId, sessionTimeout: 30_000, heartbeatInterval: 3_000,
  minBytes: 1_000_000,            // wait to accumulate ~1 MB across the fetch
  maxWaitTimeInMs: 500,           // ...but never longer than 0.5 s
  maxBytesPerPartition: 8_000_000,
});
await consumer.run({
  partitionsConsumedConcurrently: Number(env.WORKER_PARTITION_CONCURRENCY ?? 4),
  eachBatchAutoResolve: false,
  eachBatch: processBatch,
});
```

- Insert target: `events_ingest` (WS2), `async_insert=0`, `insert_deduplication_token` per WS1,
  `max_insert_block_size` default. Target 10 k–100 k rows per insert, at most about one insert per second per
  worker.
- Keep `async_insert` available behind `CLICKHOUSE_ASYNC_INSERT=true` only for very low-volume deployments
  (it weakens dedupe).
- Remove the second insert: web vitals flow through `mv_web_vitals`.
- Run the realtime Redis update concurrently with the insert (`Promise.allSettled`), keep resolving offsets
  only after the insert (and DLQ) succeed. Realtime failure remains non-fatal.
- Scaling rule: replicas ≤ partitions. Autoscale on consumer lag, not CPU.
- `autoCommitInterval` stays; offsets resolved in order (existing fix).

**Progress:** fetch tuning (`WORKER_FETCH_MIN_BYTES`, `WORKER_FETCH_MAX_WAIT_MS`,
`WORKER_FETCH_MAX_BYTES_PER_PARTITION`), `partitionsConsumedConcurrently` (`WORKER_PARTITION_CONCURRENCY`, default 4)
and the realtime update running concurrently with the insert are done. Still open: sync insert +
`insert_deduplication_token` and the `events_ingest` target, which depend on WS1/WS2 (async insert stays the
default until then, because token dedupe does not apply to it).

### Alternative considered
ClickHouse Kafka engine / Kafka Connect sink removes the worker from the hot path. Rejected for now because
the worker owns validation, DLQ and realtime fan-out; revisit if the worker becomes the cost center.

### Done when
- Sustained N events/s load test: lag stays < 10 s, `system.parts` active parts per partition < 200,
  inserts/s per table ≤ ~2.
- Kill/restart worker under load: no data loss, duplicate rate within target (WS1).

---

## WS8. Realtime (T6)

### Changes
1. **Batch per site** in `redis-realtime.ts`:
   - collapse the batch to the latest event per `(siteId, sessionId)` first;
   - per event: one `SET active:{site}:{session} payload EX 300`;
   - per site: one `ZADD rt:active:{site} score member …` (multi-member), one `ZREMRANGEBYSCORE`, one `EXPIRE`,
     one `PUBLISH rt:notify:{site}`.
   Commands per batch drop from `4 × events` to `1 × sessions + 4 × sites`.
2. **Per-site subscription** in `realtime-hub.ts`: replace `psubscribe("rt:notify:*")` with
   `subscribe("rt:notify:{siteId}")` when a hub is created and `unsubscribe` when its last listener leaves.
   Each web node then receives only the sites someone on it is watching.
3. Fallback timer: add ±20 % jitter so hubs do not all poll in the same tick; cap listeners per site (e.g. 200)
   and send an SSE heartbeat comment every 25 s so proxies keep the connection.
4. Hosting note: SSE needs a long-running Node runtime (not per-request serverless). Add this to the deploy
   docs; if serverless is required, switch the client to short polling (5 s) against the cached
   `getRealtimeSnapshot` (WS4 cache, TTL 3 s).

**Progress: done.** Worker batches collapse to the latest event per session and issue 1 `SET` per session + 4
commands per site (`redis-realtime.ts`, tested). The hub subscribes to `rt:notify:{siteId}` per site and
unsubscribes with the last listener, the fallback poll is jittered ±20 %, listeners are capped at 200 per site per
node (the stream answers `event: busy` with `retry: 10000`), and the SSE heartbeat is 25 s. Serverless hosting note
(8.4) still needs adding to the deploy docs.

### Done when
- Redis `COMMANDSTATS` at the same load show ≥ 70 % fewer commands from the worker.
- A node with no viewers receives zero `rt:notify` messages (test with a spy subscriber).

---

## WS9. Observability and documentation (O1, O2)

### 9.1 Real Prometheus metrics (O1)
Replace `expvar` in `ingestion-go` and `ingest-proxy` with `prometheus/client_golang`, served on `/metrics` in
the proper text format. Required series:

| Metric | Type | Labels |
|---|---|---|
| `http_request_duration_seconds` | histogram (buckets 1 ms … 1 s) | route, status class |
| `edge_events_total` | counter | outcome=`accepted/rejected/duplicate/dropped_bot/clamped` |
| `edge_redis_errors_total` | counter | op=`gate/dedupe` |
| `edge_kafka_publish_duration_seconds` | histogram | – |
| `edge_kafka_publish_errors_total` | counter | – |
| `edge_site_cache_total` | counter | result=`hit/miss/negative` |

Worker (`prom-client`): `worker_batch_rows`, `worker_insert_duration_seconds`, `worker_dlq_total{reason}`,
`worker_consumer_lag` (from `consumer.on(consumer.events.FETCH_START)` / admin lag). Web: route duration
histograms and `query_cache_total{result}`.

**Progress:** `ingestion-go` and `ingest-proxy` now expose Prometheus text-format request histograms with
bounded route/status labels, in-flight request gauges, and Go/process collectors. The edge also records
event outcomes, Redis gate errors, Kafka publish duration/errors, and site-cache results. Worker and web
metrics are now instrumented too: the worker serves `worker_batch_rows`, `worker_insert_duration_seconds`,
`worker_events_stored_total`, `worker_dlq_total{reason}`, `worker_consumer_lag{partition}` on `WORKER_METRICS_PORT`
(default 9464), and the web app records `query_cache_total{endpoint,result}` and `web_route_duration_seconds`
(overview and breakdown routes) at `/api/internal/metrics`, which is 404 unless `METRICS_TOKEN` is set and then needs
a Bearer token. Remaining for O1: wrap the other routes with `timedRoute`, export the scheduled-job heartbeat gauge,
and build the §10 dashboard and §9.2 alerts. The phase-0 baselines (§12) are still not recorded.

### 9.2 Alerts (minimum set)
Consumer lag > 60 s for 5 min · active parts per partition > 200 · ingest 5xx rate > 1 % · edge fail-open
events > 0 for 5 min · nightly duplicate rate > 0.01 % · reconciliation diff over threshold · dashboard p95 over
target · scheduled job heartbeat stale (already recorded in Redis by P2-8; export it as a gauge).

### 9.3 Documentation (O2)
- Update `docs/architecture/ARCHITECTURE_REVIEW.md` P2-9: Kafka key is already `siteId:sessionId`; mark it `[~]` (partition and
  replication decision remains, covered by §6.4).
- Add a runbook section per alert: what it means, first query to run, safe mitigation.

---

## 10. Observability of the plan itself (what to watch during rollout)

Create one dashboard before starting: ingest p50/p99, publish errors, consumer lag, inserts/s and parts per
partition, ClickHouse `read_rows` per query endpoint, cache hit ratio, Redis commands/s by command, duplicate
rate, reconciliation diff. Every phase in §11 has a go/no-go criterion on this dashboard.

---

## 11. Migration and rollout (zero downtime, reversible)

Feature flags (all in `@trackme/config`): `WORKER_WRITE_V2` (default `shadow`), `ANALYTICS_READ=v1|v2|shadow`
(default `v1`), `EDGE_DEDUPE` (default on), `EDGE_GATE_SCRIPT` (default on), `AUTH_STRICT_REVOCATION` (default off).

| Phase | Work | Go criterion | Rollback |
|---|---|---|---|
| 0 | Baselines (§12), dashboard (§10), Prometheus metrics (WS9.1) | numbers recorded | n/a |
| 1 | Quick correctness: funnel error handling (WS4.4), `iat` + revoke fix (WS5), workspace quota + bot policy (WS6.2) | tests green | revert commit; no schema change |
| 2 | Create `events_v2`, `events_ingest`, MVs, aggregate tables (008, 009) | migration applies on prod copy | `DROP` new objects; nothing reads them |
| 3 | **Shadow write:** worker writes `events_raw` (legacy) and `events_ingest` | v2 row count within 0.1 % of legacy per hour; no insert errors | flip `WORKER_WRITE_V2=false` |
| 4 | **Backfill history:** `INSERT INTO events_ingest SELECT … FROM events_raw WHERE received_at < {T0}` in one-day chunks, oldest first, off-peak; `T0` = shadow start time. MVs fill the aggregates as part of the insert. Use `received_at` (server time), not `timestamp`, so events delivered after `T0` with an old timestamp are not counted twice | per-day counts v1 = v2 (±dedupe) | truncate v2 and aggregates, redo |
| 5 | Edge dedupe + gate script (WS1, WS6.1) behind flags; roll to 5 % → 50 % → 100 % of edge pods | duplicate rate ≤ target; ingest p99 ≤ target | flag off |
| 6 | Worker batch tuning (WS7) and realtime changes (WS8) | lag, parts, Redis commands per targets | revert config / commit |
| 7 | **Shadow read:** `ANALYTICS_READ=shadow` runs v1 and v2 for every query, returns v1, logs differences beyond tolerance (pageviews 0.5 %, uniques 2 %, bounce ±0.5 pt, duration ±2 %) | zero unexplained diffs for 7 days | stay on v1 |
| 8 | Cutover reads to v2 (`ANALYTICS_READ=v2`), query cache and authz cache on (WS4) | p95 targets; error rate unchanged | flag back to v1 (legacy tables still live) |
| 9 | Stop legacy writes; rename legacy tables to `*_old`; retain 14 days | nothing reads `*_old` (check `system.query_log`) | rename back |
| 10 | Drop `*_old`, delete rollup jobs and `window.ts`, remove flags | – | restore from backup only |

Deploy order rules: ClickHouse migrations first, then worker, then edge, then web. Never deploy the web
reader (phase 8) before the backfill (phase 4) is verified.

---

## 12. Baseline measurements (do before phase 2)

Record these so the "≥ 30 %" and latency claims can be proven or corrected:

```sql
-- storage per column
SELECT column, formatReadableSize(sum(column_data_compressed_bytes)) AS comp,
       formatReadableSize(sum(column_data_uncompressed_bytes)) AS raw
FROM system.parts_columns
WHERE database='growth_analytics' AND table='events_raw' AND active
GROUP BY column ORDER BY sum(column_data_compressed_bytes) DESC;

-- rows scanned and duration per query shape (last 7 days)
SELECT normalizeQuery(query) q, count() n, quantile(0.95)(query_duration_ms) p95_ms,
       quantile(0.95)(read_rows) p95_rows, quantile(0.95)(memory_usage) p95_mem
FROM system.query_log WHERE type='QueryFinish' AND event_time > now() - INTERVAL 7 DAY
GROUP BY q ORDER BY p95_ms DESC LIMIT 20;

-- duplicates today
SELECT count() - uniqExact(event_id) AS dups, dups / count() AS rate FROM growth_analytics.events_raw
WHERE timestamp >= today();

-- part pressure
SELECT partition, count() parts FROM system.parts WHERE active AND table='events_raw' GROUP BY partition;
```

Also record: Redis commands per second by command (`INFO commandstats`), edge latency histogram (after 9.1),
Postgres queries per dashboard load (`pg_stat_statements`), and consumer lag.

---

## 13. Decisions needed (with recommendation)

| # | Question | Recommendation |
|---|---|---|
| 1 | Hash `session_id` / `visitor_pseudonym` to `UInt64`? | Yes, if no UI shows raw ids (grep first); else keep `String ZSTD` for that column only |
| 2 | Known bots: drop at edge vs store | Drop at edge, not billed; heuristic bots stored and not billed |
| 3 | `web_vital` events counted in visitors/pageviews? | Keep current behavior now; exclude later as a separate, announced change |
| 4 | Edge dedupe window | 25 h (SDK retry cap is 23 h) |
| 5 | Redis fail policy for dedupe/gate | Fail closed with `503` + metric and alert (`ADMISSION_FAIL_CLOSED=true`); fail-open remains a deliberate override |
| 6 | Per-site retention (P2-6) | Out of scope here. If needed: per-tier tables (e.g. 3/12/24 months) chosen at insert, not row deletes |
| 7 | Single Redis vs split (P2-10) | Split before launch at scale: (a) rate/quota/dedupe, (b) sessions/authz, (c) cache/realtime. All code already takes a role in `getRedisURLForRole` |
| 8 | `/tracker.js` CDN (P2-11) | The versioned asset publishing commit exists; finish by serving `/t/v1/*` with `Cache-Control: public, max-age=31536000, immutable` for versioned files and a short TTL for the alias |
| 9 | Dashboard hosting for SSE | Long-running Node, or short-poll fallback (WS8.4) |

---

## 14. Test and verification matrix

| Level | What | Where |
|---|---|---|
| Unit | Gate/dedupe script, claim/release, Kafka partial-failure handling, cache single-flight, range normalization, session marker logic | Go tests, vitest |
| Contract | Same fixtures through Zod and Go validator (existing) | `packages/contracts/fixtures` |
| Integration (ClickHouse) | MV outputs equal raw SQL equal JS oracle; midnight sessions; late events; bots; filters; backfill idempotency; partition replace repair | extend `rollups.integration.test.ts` |
| Integration (auth) | Revoke-all with Redis warm/flushed; Postgres outage matrix | web tests |
| Load | Edge (k6/vegeta), worker (produce N events/s into Kafka), dashboards (50 concurrent) with `clickhouse-benchmark` for query shapes | `scripts/` |
| Chaos | Redis down, Kafka down, ClickHouse down, worker kill, duplicate storm (same batch 100×) | staging |
| Reconciliation | Nightly MV vs raw; nightly duplicate rate | scheduled-worker |

Every PR in this plan updates this file's status and, where a threshold in §0 is involved, attaches the
before/after number.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| MV logic differs subtly from the old rollup SQL | Shadow read with tolerances (phase 7); oracle tests |
| Aggregate tables double-count if someone inserts into them manually | Repair only by partition replace (§7.5); document and forbid direct inserts; read-only grants for everyone but the MV owner |
| Dedupe claims leave orphaned pending keys on crash | 120 s pending TTL; at worst a retry after 2 minutes is accepted |
| `UInt64` hash collisions (≈ n²/2⁶⁵; negligible at 10⁹ sessions per site) | Accept; document |
| `path` cardinality blows up `dim_daily_agg` | Path normalizer setting; alert on rows per site-day; read-time `LIMIT` |
| Backfill load hurts live ingest | One day per chunk, off-peak, `max_threads` capped, throttle on parts-per-partition metric |
| Cache serves slightly stale numbers | TTL ≤ 30 s for live ranges; shown "updated N s ago" in UI |
| Rewrite of many queries at once | Per-endpoint flag; legacy path stays until phase 9 |

---

## 16. Work breakdown (checklist)

- [ ] Baselines and rollout dashboard (§10, §12)
- [~] Prometheus metrics: Go services, worker and web (overview/breakdown) done; dashboard, alerts and remaining routes open (WS9.1)
- [x] Funnel: throw on error, step pre-filter, `startsWith` (WS4.4)
- [x] Sessions: `iat`, `sessions_valid_after`, fail-closed validation, mandatory DB insert (WS5)
- [x] Workspace-level quota in resolver; bot policy (WS6.2)
- [ ] `008_events_v2.sql` (+ `events_ingest`, `mv_events_ingest`) (WS2)
- [ ] `009_aggregates.sql` (six tables, six MVs) (WS3)
- [~] Worker: fetch tuning, concurrency, concurrent realtime done; `events_ingest`, dedupe token, sync inserts open (WS7)
- [ ] Backfill script `scripts/backfill-events-v2.ts` with `received_at < T0`, per-day chunks, resumable
- [x] Edge: dedupe claim/confirm/release, partial-write handling, zstd, linger, `Gate.Admit` Lua (behind `EDGE_GATE_SCRIPT`; load test and 5 % -> 100 % rollout still to do) (WS1, WS6)
- [x] Realtime batching and per-site subscribe (WS8)
- [ ] Analytics read paths on new tables + `ANALYTICS_READ` flag + shadow compare (WS3)
- [x] Query cache (overview, breakdown, funnel), authz cache, read-only ClickHouse user (WS4; 4.5 raw-scan guard still open)
- [ ] Nightly reconciliation and duplicate-rate jobs (WS1, WS3)
- [ ] Cutover, decommission legacy tables and rollup jobs (§11 phases 8–10)
- [~] Update `docs/architecture/ARCHITECTURE_REVIEW.md` (O2 done: P2-9 key is `siteId:sessionId`) and add runbooks (WS9.3)

## Managed services (Aiven)

`infra/aiven/` is an alternative to Docker for managed Postgres, ClickHouse and Kafka: Kafka TLS/SASL (`KAFKA_SSL`, `KAFKA_SASL_*`, `KAFKA_CA_CERT_PATH`) in the worker, DLQ and Go edge; optional `CLICKHOUSE_CA_CERT_PATH`; `migrate-clickhouse.mjs` and `create-kafka-topics.mjs`. Not yet run against live services.

**Note (6.3):** kafkajs has no built-in zstd decoder, so the event worker registers one (`services/event-worker/src/zstd-codec.ts`, decode-only, `fzstd`). Without it every zstd batch fails with "ZSTD compression not implemented". Found on first end-to-end run.

## Progress: WS2/WS3 write path (phase 3)

- `008`/`009` applied on Aiven ClickHouse (found and fixed two bugs: multi-table `RENAME` in `006` is refused by Replicated databases; `session_day_agg.pageviews` must be `UInt64`).
- Worker flag `WORKER_WRITE_V2=off|shadow|only` (default `shadow`). `shadow` keeps legacy authoritative and also writes `events_ingest`; a v2 failure only increments `worker_v2_write_errors_total`. `only` writes `events_ingest` alone (also replaces the second `web_vitals` insert).
- v2 inserts are synchronous with `insert_deduplication_token` (sha1 of the batch's event ids) and `deduplicate_blocks_in_dependent_materialized_views=1`.
- Verified on the live service: inserting the same batch twice stored 4 rows (not 8); `site_daily_agg` = 3 pageviews / 2 visitors / 2 sessions; `web_vitals_agg` = 1 sample; `referrer_domain` and `country` derived correctly.
- Still to do: shadow-read flag `ANALYTICS_READ` and the read-path rewrite, backfill script, reconciliation job, then cutover and decommission.

## Progress: WS3 read path, backfill, reconciliation, observability (phases 4 and 7 ready)

- **Read flag** `ANALYTICS_READ=v1|v2|shadow` (default `v1`) in `@trackme/config`; `packages/analytics/src/read-mode.ts`
  holds `dispatch`/`variantAware` (shadow runs both, returns v1, reports differences through `setShadowReporter`, and a
  failing v2 never affects the answer). The web app counts differences in `analytics_shadow_diff_total{query}`.
- **v2 reads:** overview (whole days from `site_daily_agg` + `session_day_agg`, edge days from `events_v2`; sessions are
  re-joined across midnight by grouping on `session_hash`), breakdowns (`dim_daily_agg`, or `filter_daily_agg` when
  filtered), web vitals (`web_vitals_agg` t-digest states), and every event-level query (time series, custom events, goals,
  campaigns, journeys, recent events, first-event, user timeline, funnels) through `toV2Sql` onto `events_v2`.
- **Deviations from the plan:** a filtered overview reads `events_v2` for the whole range (bounce and duration need
  per-session rows), guarded to 31 days; the referrer breakdown lists domains in v2 (not full URLs); web vitals p75 is a
  t-digest estimate and v2 excludes bots.
- **4.5 raw-scan guard:** `assertRawScanRange` (31 days) on the v2 filtered overview and on goal path rules, surfaced
  as 422 `RANGE_TOO_WIDE`.
- **Verified on live ClickHouse** (`packages/analytics/src/read-v2.integration.test.ts`, scratch database, run with
  `CLICKHOUSE_TEST_URL`): overview, breakdowns (path, country, device; 24h, 7d, filtered), time series, custom events,
  web vitals, journeys, recent events and first-event agree between v1 and v2 on the same traffic, including sessions that
  cross midnight; the aggregate tables hold a small fraction of the raw row count; backfill copies a legacy-only site and a
  second run copies nothing.
- **Backfill:** `scripts/backfill-events-v2.ts --t0 <shadow start>` (library in `packages/analytics/src/backfill.ts`),
  by `received_at`, one day at a time, oldest first, skips completed days and refuses a partly copied day.
- **Reconciliation + duplicate rate:** `services/scheduled-worker/src/jobs/reconciliation.ts`, nightly at 04:20 UTC when
  `WORKER_WRITE_V2` is not `off`; a finding fails the run and sets `reconciliation_findings`.
- **WS9:** scheduled-job heartbeat (`scheduled_job_last_success_timestamp_seconds{task}` on `SCHEDULER_METRICS_PORT`,
  default 9465), `infra/observability/alerts.yml`, `infra/observability/grafana-dashboard.json`, `docs/operations/RUNBOOK.md`,
  `infra/ops/baselines.sql`. Pages and the remaining dashboard routes use `lib/cached-analytics.ts` and `timedRoute`.
- **Test infra:** the web `pnpm test` hang is fixed (explicit glob; Node 21+ for the glob argument).
- **Still to do:** run shadow write and shadow read against real traffic for the go/no-go windows, record the section 12
  baselines (`infra/ops/baselines.sql`) on that data, cut over (`ANALYTICS_READ=v2`), then decommission the legacy
  rollup jobs and tables (phase 9-10). The people-timeline route is not cached (per-user, low reuse). Load test and
  rollout of `EDGE_GATE_SCRIPT` are still open.
