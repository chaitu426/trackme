-- ==============================================================================
-- ClickHouse Migration: identified-user profiles, built from the event stream
--
-- The People page and Segments read a Postgres table (site_user_profiles) that only a server-side API
-- call could fill; the tracker's identify() reached ClickHouse and stopped there. identify() puts the
-- distinct id and every trait into the event's properties, and later events carry just the distinct id,
-- so profiles can be derived from events_v2 with no change to the edge or the worker.
--
-- One row per (site, distinct id) per insert block; AggregatingMergeTree folds them, and readers merge
-- (min / max / sum / uniqCombined64Merge / argMaxMerge) so they are right before and after merges.
--   traits   = properties_json of the most recent `identify` event (argMax by timestamp). Events that are
--              not identify contribute an empty value at timestamp 0, so they never win.
-- Humans only, like every other aggregate. This table holds emails and other traits: it is covered by the
-- retention job (RETENTION_TABLES) and by erasure (ERASURE_SQL), and has the same 60-month TTL ceiling.
--
-- Do NOT insert into it by hand: sum columns would double count. Needs events_v2 (migration 008) and
-- WORKER_WRITE_V2 = shadow or only; with v2 writes off this table stays empty.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.site_profiles_agg
(
    workspace_id UUID,
    site_id      UUID,
    distinct_id  String,
    first_seen   SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen    SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    events       SimpleAggregateFunction(sum, UInt64),
    sessions     AggregateFunction(uniqCombined64, UInt64),
    traits       AggregateFunction(argMax, String, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(last_seen)
ORDER BY (workspace_id, site_id, distinct_id)
TTL toDateTime(last_seen) + INTERVAL 60 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_site_profiles
TO growth_analytics.site_profiles_agg AS
SELECT
    workspace_id,
    site_id,
    JSONExtractString(properties_json, 'distinctId') AS distinct_id,
    min(timestamp)                                   AS first_seen,
    max(timestamp)                                   AS last_seen,
    toUInt64(count())                                AS events,
    uniqCombined64State(session_hash)                AS sessions,
    argMaxState(
        if(type = 'identify', properties_json, ''),
        if(type = 'identify', timestamp, toDateTime64(0, 3, 'UTC'))
    )                                                AS traits
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND distinct_id != ''
GROUP BY workspace_id, site_id, distinct_id;

-- ------------------------------------------------------------------------------
-- One-time backfill for events already in events_v2 (the view only sees new inserts). Run it ONCE, after the
-- view exists, while the worker is paused or accepting that a few seconds of overlap would double count:
--
-- INSERT INTO growth_analytics.site_profiles_agg
-- SELECT workspace_id, site_id, JSONExtractString(properties_json, 'distinctId') AS distinct_id,
--        min(timestamp), max(timestamp), toUInt64(count()), uniqCombined64State(session_hash),
--        argMaxState(if(type = 'identify', properties_json, ''),
--                    if(type = 'identify', timestamp, toDateTime64(0, 3, 'UTC')))
-- FROM growth_analytics.events_v2
-- WHERE bot_status = 'human' AND distinct_id != '' AND timestamp < now() - INTERVAL 1 MINUTE
-- GROUP BY workspace_id, site_id, distinct_id;
-- ------------------------------------------------------------------------------
