-- ==============================================================================
-- ClickHouse Migration: Error Tracking (Phase 1A)
--
-- The worker fingerprints each `error` event (services/event-worker/src/errors) and writes:
--
--   error_ingest        Null-engine entry point. The worker sends raw ids; the view below hashes them, so the
--                       hash definition (cityHash64) lives in one place, as it does for events_v2.
--   error_events        one compact row per error. Hot table: 30-day TTL, daily partitions so expiry drops whole parts.
--   error_groups        one row per issue: first/last seen, total events, distinct users, first/last release,
--                       title. Maintained by a view over error_events. Lifetime of an issue: 12 months after last seen.
--   error_group_daily   per issue per day per release and environment: events, distinct users, last seen.
--                       The primary query path for the issue list and the trend sparklines. 12 months.
--   error_occurrences   the sampled detail (stack, breadcrumbs, tags), at most 5 per issue per day, chosen by the
--                       worker. Stack and breadcrumbs are JSON text compressed by the column codec. 30-day TTL.
--
-- "Users" is a distinct count of the identified user when the SDK knew one, otherwise of the visitor pseudonym.
-- Pseudonyms rotate every 24 hours, so over several days an anonymous person is counted once per day.
--
-- Issue status (open, resolved, ignored) is mutable and low volume: it lives in Postgres, not here.
-- Needs migration 014 for release and environment. Rollback: down/016_error_tracking.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.error_ingest
(
    workspace_id      UUID,
    site_id           UUID,
    group_id          UInt64,
    ts                DateTime64(3, 'UTC'),
    release           String,
    environment       String,
    level             String,
    session_id        String,
    visitor_pseudonym String,
    user_id           String,
    title             String,
    etype             String,
    browser           String,
    country           String
)
ENGINE = Null;

CREATE TABLE IF NOT EXISTS growth_analytics.error_events
(
    workspace_id UUID,
    site_id      UUID,
    group_id     UInt64,
    ts           DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    release      LowCardinality(String),
    environment  LowCardinality(String),
    level        LowCardinality(String),
    session_hash UInt64,
    visitor_hash UInt64,
    user_hash    UInt64,
    title        String CODEC(ZSTD(3)),
    etype        LowCardinality(String),
    browser      LowCardinality(String),
    country      LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (site_id, group_id, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_error_ingest
TO growth_analytics.error_events AS
SELECT
    workspace_id,
    site_id,
    group_id,
    ts,
    release,
    environment,
    level,
    cityHash64(session_id)                                   AS session_hash,
    cityHash64(visitor_pseudonym)                            AS visitor_hash,
    if(user_id != '', cityHash64(user_id), toUInt64(0))      AS user_hash,
    title,
    etype,
    browser,
    country
FROM growth_analytics.error_ingest;

CREATE TABLE IF NOT EXISTS growth_analytics.error_groups
(
    site_id       UUID,
    group_id      UInt64,
    first_seen    SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen     SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    events        SimpleAggregateFunction(sum, UInt64),
    users         AggregateFunction(uniqCombined64, UInt64),
    first_release AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    last_release  AggregateFunction(argMax, String, DateTime64(3, 'UTC')),
    title         SimpleAggregateFunction(anyLast, String),
    etype         SimpleAggregateFunction(anyLast, String),
    level         SimpleAggregateFunction(anyLast, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (site_id, group_id)
TTL toDateTime(last_seen) + INTERVAL 12 MONTH DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_error_groups
TO growth_analytics.error_groups AS
SELECT
    site_id,
    group_id,
    min(ts)                                                              AS first_seen,
    max(ts)                                                              AS last_seen,
    toUInt64(count())                                                    AS events,
    uniqCombined64State(if(user_hash != 0, user_hash, visitor_hash))     AS users,
    argMinState(toString(release), ts)                                   AS first_release,
    argMaxState(toString(release), ts)                                   AS last_release,
    anyLast(title)                                                       AS title,
    anyLast(toString(etype))                                             AS etype,
    anyLast(toString(level))                                             AS level
FROM growth_analytics.error_events
GROUP BY site_id, group_id;

CREATE TABLE IF NOT EXISTS growth_analytics.error_group_daily
(
    site_id     UUID,
    group_id    UInt64,
    date        Date,
    release     String,
    environment String,
    events      SimpleAggregateFunction(sum, UInt64),
    users       AggregateFunction(uniqCombined64, UInt64),
    last_ts     SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, group_id, date, release, environment)
TTL date + INTERVAL 12 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_error_group_daily
TO growth_analytics.error_group_daily AS
SELECT
    site_id,
    group_id,
    toDate(ts)                                                           AS date,
    toString(release)                                                    AS release,
    toString(environment)                                                AS environment,
    toUInt64(count())                                                    AS events,
    uniqCombined64State(if(user_hash != 0, user_hash, visitor_hash))     AS users,
    max(ts)                                                              AS last_ts
FROM growth_analytics.error_events
GROUP BY site_id, group_id, date, release, environment;

CREATE TABLE IF NOT EXISTS growth_analytics.error_occurrences
(
    workspace_id UUID,
    site_id      UUID,
    group_id     UInt64,
    ts           DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    event_id     UUID,
    release      LowCardinality(String),
    environment  LowCardinality(String),
    session_id   String,
    user_id      String,
    path         String CODEC(ZSTD(3)),
    browser      LowCardinality(String),
    os           LowCardinality(String),
    stack        String CODEC(ZSTD(3)),
    breadcrumbs  String CODEC(ZSTD(3)),
    tags         String CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (site_id, group_id, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;
