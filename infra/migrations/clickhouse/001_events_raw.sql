-- ==============================================================================
-- ClickHouse Migration: Raw Analytics Events
-- Table: events_raw
-- Engine: ReplacingMergeTree (deduplicates by event_id across retries)
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS growth_analytics;

CREATE TABLE IF NOT EXISTS growth_analytics.events_raw (
    -- Identification & Multi-tenancy
    event_id UUID,
    schema_version UInt8 DEFAULT 1,
    workspace_id UUID,
    site_id UUID,
    site_key LowCardinality(String),

    -- Timestamps
    timestamp DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC') DEFAULT now64(3),

    -- Event details
    type LowCardinality(String), -- 'pageview', 'custom', 'web_vital'
    event_name LowCardinality(String) DEFAULT 'pageview',

    -- Identity & Session (Privacy-preserving)
    session_id String,
    visitor_pseudonym String,

    -- Navigation
    url String,
    path String,
    title String,
    referrer String,

    -- Campaign & UTM
    campaign_source LowCardinality(String) DEFAULT '',
    campaign_medium LowCardinality(String) DEFAULT '',
    campaign_name LowCardinality(String) DEFAULT '',
    campaign_term LowCardinality(String) DEFAULT '',
    campaign_content LowCardinality(String) DEFAULT '',

    -- Geolocation & Device (Derived transiently, IP discarded)
    country LowCardinality(FixedString(2)) DEFAULT '',
    city String DEFAULT '',
    browser LowCardinality(String) DEFAULT '',
    os LowCardinality(String) DEFAULT '',
    device LowCardinality(String) DEFAULT 'desktop', -- 'desktop', 'mobile', 'tablet'

    -- Bot classification
    bot_status LowCardinality(String) DEFAULT 'human', -- 'human', 'known_bot', 'heuristic_bot'

    -- Custom Properties JSON
    properties_json String DEFAULT '{}'
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (workspace_id, site_id, toDate(timestamp), type, event_name, event_id)
SETTINGS index_granularity = 8192;

