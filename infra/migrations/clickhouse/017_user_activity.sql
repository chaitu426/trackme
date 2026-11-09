-- ==============================================================================
-- ClickHouse Migration: per-user activity for Retention & Cohorts (Phase 1B)
--
-- Once identify() has run, the tracker puts the user's id into the properties of every pageview and custom event
-- (properties.distinctId). So who was active on which day can be kept by materialized views over events_v2, exactly,
-- incrementally, with no join and no nightly job.
--
-- ONLY IDENTIFIED USERS ARE HERE. Anonymous visitors get a new pseudonym every 24 hours (by design and by the privacy
-- policy), so they cannot be followed across days and cannot appear in retention.
--
--   user_active_day    one row per identified user per day they were active (a pageview or custom event).
--   user_first_day     the first day each identified user was ever seen: the default cohort.
--   user_event_day     one row per user per day per named custom event: lets a cohort start at, or a return be
--                      counted as, a specific event (signup, purchase).
--
-- These tables hold raw user ids, so they are covered by erasure (packages/analytics/src/erasure.ts).
-- Retention: 25 months, by table TTL. Humans only, like every other aggregate.
-- Needs events_v2 (008) and WORKER_WRITE_V2 = shadow or only. Rollback: down/017_user_activity.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.user_active_day
(
    workspace_id UUID,
    site_id      UUID,
    date         Date,
    user_id      String,
    events       SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, user_id)
TTL date + INTERVAL 25 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_user_active_day
TO growth_analytics.user_active_day AS
SELECT
    workspace_id,
    site_id,
    toDate(timestamp)                                AS date,
    JSONExtractString(properties_json, 'distinctId') AS user_id,
    toUInt64(count())                                AS events
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND type IN ('pageview', 'custom') AND user_id != ''
GROUP BY workspace_id, site_id, date, user_id;

CREATE TABLE IF NOT EXISTS growth_analytics.user_first_day
(
    workspace_id UUID,
    site_id      UUID,
    user_id      String,
    first_day    SimpleAggregateFunction(min, Date)
)
ENGINE = AggregatingMergeTree
ORDER BY (site_id, user_id)
TTL first_day + INTERVAL 25 MONTH DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_user_first_day
TO growth_analytics.user_first_day AS
SELECT
    workspace_id,
    site_id,
    JSONExtractString(properties_json, 'distinctId') AS user_id,
    min(toDate(timestamp))                           AS first_day
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND type IN ('pageview', 'custom') AND user_id != ''
GROUP BY workspace_id, site_id, user_id;

CREATE TABLE IF NOT EXISTS growth_analytics.user_event_day
(
    workspace_id UUID,
    site_id      UUID,
    event_name   String,
    date         Date,
    user_id      String,
    events       SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, event_name, date, user_id)
TTL date + INTERVAL 25 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_user_event_day
TO growth_analytics.user_event_day AS
SELECT
    workspace_id,
    site_id,
    event_name,
    toDate(timestamp)                                AS date,
    JSONExtractString(properties_json, 'distinctId') AS user_id,
    toUInt64(count())                                AS events
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND type = 'custom' AND event_name != '' AND user_id != ''
GROUP BY workspace_id, site_id, event_name, date, user_id;
