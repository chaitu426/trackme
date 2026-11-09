-- ==============================================================================
-- ClickHouse Migration: user timeline for User 360 (Phase 2A)
--
-- One compact row per thing an IDENTIFIED user did: a page they viewed, an event they triggered, an error they hit.
-- Kept by a materialized view over events_v2 as events arrive, so opening a person's timeline reads only that
-- person's rows, in key order (no scan of events). The detail of a row (a stack, a property bag) is fetched on demand.
--
--   kind      page | event | error today. It is an open string: payments, feedback and flag exposures (later phases)
--             add their own kinds without changing this table.
--   summary   what to show on the row, at most 200 characters: a page's path WITHOUT its query string (query strings
--             carry tokens and emails), an event's name, an error's scrubbed title.
--   severity  info | warning | error.
--   ref       what the row links to: an error's issue id, a page's path.
--
-- Anonymous events are not here: the user is read from properties.distinctId, which the tracker sets after identify().
-- Retention 90 days by TTL (daily partitions, so expiry drops whole parts). Holds raw user ids: covered by erasure.
-- Needs events_v2 (008) and migration 014. Rollback: down/018_user_timeline.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.user_timeline
(
    workspace_id UUID,
    site_id      UUID,
    user_id      String,
    ts           DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    event_id     UUID,
    kind         LowCardinality(String),
    summary      String CODEC(ZSTD(3)),
    severity     LowCardinality(String),
    ref          String CODEC(ZSTD(3)),
    session_hash UInt64,
    release      LowCardinality(String),
    country      LowCardinality(String),
    device       LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (site_id, user_id, ts, event_id)
TTL toDateTime(ts) + INTERVAL 90 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_user_timeline
TO growth_analytics.user_timeline AS
SELECT
    workspace_id,
    site_id,
    JSONExtractString(properties_json, 'distinctId') AS user_id,
    timestamp                                         AS ts,
    event_id,
    multiIf(type = 'pageview', 'page', type = 'custom', 'event', 'error')  AS kind,
    substring(
        multiIf(
            type = 'pageview', splitByChar('?', path)[1],
            type = 'custom', event_name,
            JSONExtractString(properties_json, 'title')
        ),
        1, 200
    )                                                 AS summary,
    multiIf(
        type != 'error', 'info',
        JSONExtractString(properties_json, 'level') IN ('fatal', 'error'), 'error',
        JSONExtractString(properties_json, 'level') = 'warning', 'warning',
        'info'
    )                                                 AS severity,
    multiIf(
        type = 'pageview', substring(splitByChar('?', path)[1], 1, 200),
        type = 'error', JSONExtractString(properties_json, 'groupId'),
        ''
    )                                                 AS ref,
    session_hash,
    release,
    country,
    device
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND type IN ('pageview', 'custom', 'error') AND user_id != '';
