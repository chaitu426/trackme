-- ==============================================================================
-- ClickHouse Migration: Rollup & Aggregate Tables
-- Tables: pageview_rollups_hourly, pageview_rollups_daily, event_rollups_daily
-- Engine: ReplacingMergeTree
--
-- These jobs recompute rolling windows (e.g. the trailing 2 hours) on every
-- run so that late-arriving events get picked up. That means the same
-- (workspace, site, bucket, dimensions) key is re-inserted on every run with
-- a freshly recomputed value for that key. SummingMergeTree would add the
-- old and new snapshots together and inflate every metric on each overlap;
-- ReplacingMergeTree keeps only the newest snapshot per key (by
-- inserted_at), which is correct for idempotent recomputation. Readers must
-- query these tables with FINAL (or dedupe via argMax) since replacement
-- only happens at merge time.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.pageview_rollups_hourly (
    workspace_id UUID,
    site_id UUID,
    hour_timestamp DateTime('UTC'),
    path String,
    referrer String,
    country LowCardinality(FixedString(2)),
    browser LowCardinality(String),
    device LowCardinality(String),
    campaign_source LowCardinality(String),
    campaign_medium LowCardinality(String),
    campaign_name LowCardinality(String),

    -- Aggregated metrics
    pageviews UInt32,
    unique_visitors UInt32,
    unique_sessions UInt32,

    -- ReplacingMergeTree version: the most recent recomputation wins
    inserted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(hour_timestamp)
ORDER BY (
    workspace_id, site_id, hour_timestamp, path, referrer, country,
    browser, device, campaign_source, campaign_medium, campaign_name
);

CREATE TABLE IF NOT EXISTS growth_analytics.pageview_rollups_daily (
    workspace_id UUID,
    site_id UUID,
    date Date,
    path String,
    referrer String,
    country LowCardinality(FixedString(2)),
    browser LowCardinality(String),
    device LowCardinality(String),
    campaign_source LowCardinality(String),
    campaign_medium LowCardinality(String),
    campaign_name LowCardinality(String),

    -- Aggregated metrics
    pageviews UInt32,
    unique_visitors UInt32,
    unique_sessions UInt32,

    inserted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(date)
ORDER BY (
    workspace_id, site_id, date, path, referrer, country,
    browser, device, campaign_source, campaign_medium, campaign_name
);

CREATE TABLE IF NOT EXISTS growth_analytics.event_rollups_daily (
    workspace_id UUID,
    site_id UUID,
    date Date,
    event_name LowCardinality(String),

    -- Aggregated metrics
    total_count UInt32,
    unique_sessions UInt32,
    unique_visitors UInt32,

    inserted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, site_id, date, event_name);
