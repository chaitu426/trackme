-- ==============================================================================
-- ClickHouse Migration: suite foundation (identity map, session summaries, metric rollups)
--
-- Everything is derived from events_v2 by materialized views, like migration 009 and 013: the
-- aggregates are computed once, at insert time, and dashboards never rescan raw events for them.
-- Humans only, like every other aggregate. Needs migration 014 (release, environment) and
-- WORKER_WRITE_V2 = shadow or only; with v2 writes off these tables stay empty.
--
--   identity_map          visitor -> user, from `identify` events. Last identify wins (ReplacingMergeTree on
--                         linked_at). Holds raw user ids, so it is covered by erasure (packages/analytics/src/erasure.ts).
--   session_summary_agg   one row per (site, day, session): first/last seen, entry page, release, event, error
--                         and payment counts, revenue. Powers User 360, Release Impact, Revenue Leak and Churn
--                         without scanning events. Holds hashes only: no identifier, so it is anonymous.
--   metric_rollup_*       counts of the suite event kinds (error, api_call, payment, ...) by minute / hour / day,
--                         sliced by release, country, device, browser and path. One generic mechanism for every
--                         feature, instead of one rollup table each. Pageviews are NOT here: dim_daily_agg has them.
--
-- Revenue convention (Phase 3 writes it): a `payment` event carries properties.amount_minor (integer minor
-- units) and properties.status; only status = 'captured' adds to revenue_minor.
--
-- Retention is the table TTL: minute 7 days, hour 90 days, day 25 months, session summaries 90 days,
-- identity map 25 months. These are shorter than any site's raw-event retention, so the per-site
-- retention job does not need to touch them.
-- Rollback: down/015_suite_foundation.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.identity_map
(
    workspace_id UUID,
    site_id      UUID,
    visitor_hash UInt64,
    user_id      String,
    linked_at    DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(linked_at)
ORDER BY (site_id, visitor_hash)
TTL toDateTime(linked_at) + INTERVAL 25 MONTH DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_identity_map
TO growth_analytics.identity_map AS
SELECT
    workspace_id,
    site_id,
    visitor_hash,
    JSONExtractString(properties_json, 'distinctId') AS user_id,
    timestamp AS linked_at
FROM growth_analytics.events_v2
WHERE type = 'identify' AND bot_status = 'human' AND user_id != '';

CREATE TABLE IF NOT EXISTS growth_analytics.session_summary_agg
(
    site_id       UUID,
    date          Date,
    session_hash  UInt64,
    first_ts      SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_ts       SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    entry_path    AggregateFunction(argMinIf, String, DateTime64(3, 'UTC'), UInt8),
    release       AggregateFunction(argMaxIf, String, DateTime64(3, 'UTC'), UInt8),
    events        SimpleAggregateFunction(sum, UInt64),
    errors        SimpleAggregateFunction(sum, UInt64),
    payments      SimpleAggregateFunction(sum, UInt64),
    revenue_minor SimpleAggregateFunction(sum, Int64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, session_hash)
TTL date + INTERVAL 90 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_session_summary
TO growth_analytics.session_summary_agg AS
SELECT
    site_id,
    toDate(timestamp)                                                  AS date,
    session_hash,
    min(timestamp)                                                     AS first_ts,
    max(timestamp)                                                     AS last_ts,
    argMinIfState(path, timestamp, type = 'pageview')                  AS entry_path,
    argMaxIfState(toString(release), timestamp, release != '')         AS release,
    toUInt64(count())                                                  AS events,
    toUInt64(countIf(type = 'error'))                                  AS errors,
    toUInt64(countIf(type = 'payment'))                                AS payments,
    toInt64(sumIf(JSONExtractInt(properties_json, 'amount_minor'),
        type = 'payment' AND JSONExtractString(properties_json, 'status') = 'captured')) AS revenue_minor
FROM growth_analytics.events_v2
WHERE bot_status = 'human'
GROUP BY site_id, date, session_hash;

-- Generic rollups. dim = '' is the unsliced total for the metric. Minute rollups keep only the total
-- and the release slice (alerting and release comparison need no more), which holds the insert cost down.
CREATE TABLE IF NOT EXISTS growth_analytics.metric_rollup_minute
(
    site_id   UUID,
    bucket    DateTime('UTC'),
    metric    LowCardinality(String),
    dim       LowCardinality(String),
    dim_value String,
    value     UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMMDD(bucket)
ORDER BY (site_id, metric, dim, bucket, dim_value)
TTL bucket + INTERVAL 7 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS growth_analytics.metric_rollup_hour
(
    site_id   UUID,
    bucket    DateTime('UTC'),
    metric    LowCardinality(String),
    dim       LowCardinality(String),
    dim_value String,
    value     UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY (site_id, metric, dim, bucket, dim_value)
TTL bucket + INTERVAL 90 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS growth_analytics.metric_rollup_day
(
    site_id   UUID,
    bucket    Date,
    metric    LowCardinality(String),
    dim       LowCardinality(String),
    dim_value String,
    value     UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY (site_id, metric, dim, bucket, dim_value)
TTL bucket + INTERVAL 25 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_metric_rollup_minute
TO growth_analytics.metric_rollup_minute AS
SELECT
    site_id,
    toStartOfMinute(timestamp) AS bucket,
    type                       AS metric,
    d.1                        AS dim,
    d.2                        AS dim_value,
    toUInt64(count())          AS value
FROM growth_analytics.events_v2
ARRAY JOIN [('', ''), ('release', toString(release))] AS d
WHERE bot_status = 'human'
  AND type IN ('error', 'api_call', 'payment', 'flag_exposure', 'feedback', 'heartbeat', 'deploy')
GROUP BY site_id, bucket, metric, dim, dim_value;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_metric_rollup_hour
TO growth_analytics.metric_rollup_hour AS
SELECT
    site_id,
    toStartOfHour(timestamp) AS bucket,
    type                     AS metric,
    d.1                      AS dim,
    d.2                      AS dim_value,
    toUInt64(count())        AS value
FROM growth_analytics.events_v2
ARRAY JOIN [('', ''), ('release', toString(release)), ('country', country), ('device', device),
            ('browser', browser), ('path', path)] AS d
WHERE bot_status = 'human'
  AND type IN ('error', 'api_call', 'payment', 'flag_exposure', 'feedback', 'heartbeat', 'deploy')
GROUP BY site_id, bucket, metric, dim, dim_value;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_metric_rollup_day
TO growth_analytics.metric_rollup_day AS
SELECT
    site_id,
    toDate(timestamp) AS bucket,
    type              AS metric,
    d.1               AS dim,
    d.2               AS dim_value,
    toUInt64(count()) AS value
FROM growth_analytics.events_v2
ARRAY JOIN [('', ''), ('release', toString(release)), ('country', country), ('device', device),
            ('browser', browser), ('path', path)] AS d
WHERE bot_status = 'human'
  AND type IN ('error', 'api_call', 'payment', 'flag_exposure', 'feedback', 'heartbeat', 'deploy')
GROUP BY site_id, bucket, metric, dim, dim_value;
