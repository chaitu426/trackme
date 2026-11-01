-- ==============================================================================
-- ClickHouse Migration: events_v2 (optimization plan WS2)
--
-- events_v2   plain MergeTree, sort key matches every dashboard filter
--             (site + date range + type). Duplicates are stopped at the edge and
--             by the worker insert token, not by the engine, so no FINAL.
-- events_ingest + mv_events_ingest
--             The worker inserts raw strings into a Null-engine table. The MV
--             hashes ids and derives columns, so there is one hash definition
--             (cityHash64) and adding a column never touches the hot table.
--
-- Nothing reads or writes these yet: this migration is additive and reversible
-- (DROP the three objects). Run before deploying the worker.
-- ==============================================================================

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
    referrer_domain   LowCardinality(String),

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
    goal              LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
PRIMARY KEY (site_id, toDate(timestamp), type, event_name)
ORDER BY (site_id, toDate(timestamp), type, event_name, session_hash, timestamp)
TTL toDateTime(timestamp) + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1,
         non_replicated_deduplication_window = 1000,
         index_granularity = 8192;

CREATE TABLE IF NOT EXISTS growth_analytics.events_ingest
(
    event_id          UUID,
    schema_version    UInt8 DEFAULT 2,
    workspace_id      UUID,
    site_id           UUID,
    site_key          String DEFAULT '',

    timestamp         DateTime64(3, 'UTC'),
    received_at       DateTime64(3, 'UTC') DEFAULT now64(3),

    type              String,
    event_name        String DEFAULT '',

    session_id        String,
    visitor_pseudonym String,

    url               String DEFAULT '',
    path              String,
    title             String DEFAULT '',
    referrer          String DEFAULT '',

    campaign_source   String DEFAULT '',
    campaign_medium   String DEFAULT '',
    campaign_name     String DEFAULT '',
    campaign_term     String DEFAULT '',
    campaign_content  String DEFAULT '',

    country           String DEFAULT '',
    city              String DEFAULT '',
    browser           String DEFAULT '',
    os                String DEFAULT '',
    device            String DEFAULT 'desktop',
    bot_status        String DEFAULT 'human',

    vital_name        String DEFAULT '',
    vital_value       Float64 DEFAULT 0,
    vital_rating      String DEFAULT '',
    vital_nav_type    String DEFAULT '',

    properties_json   String DEFAULT '{}'
)
ENGINE = Null;

-- referrer_domain and goal are computed here rather than as MATERIALIZED columns
-- so every downstream aggregate MV sees them without relying on view ordering.
-- country is trimmed because the legacy worker sends a two-space placeholder.
CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_events_ingest
TO growth_analytics.events_v2 AS
SELECT
    event_id,
    site_id,
    workspace_id,
    schema_version,
    timestamp,
    received_at,
    type,
    event_name,
    cityHash64(session_id)        AS session_hash,
    cityHash64(visitor_pseudonym) AS visitor_hash,
    path,
    title,
    referrer,
    domainWithoutWWW(referrer)    AS referrer_domain,
    campaign_source,
    campaign_medium,
    campaign_name,
    campaign_term,
    campaign_content,
    trimBoth(country)             AS country,
    city,
    browser,
    os,
    device,
    bot_status,
    vital_name,
    vital_value,
    vital_rating,
    vital_nav_type,
    properties_json,
    JSONExtractString(properties_json, 'goal') AS goal
FROM growth_analytics.events_ingest;
