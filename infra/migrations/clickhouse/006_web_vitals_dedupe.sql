-- ==============================================================================
-- ClickHouse Migration: make web_vitals idempotent
--
-- The event-worker delivers at least once, so a batch can be written twice. The
-- original web_vitals table is a plain MergeTree and kept both copies, which
-- inflates sample counts and skews percentiles. This replaces it with a
-- ReplacingMergeTree keyed on event_id, the same way events_raw collapses
-- duplicates. Readers use FINAL (see the packages/analytics web-vitals query).
--
-- RUN ONCE. On an existing deployment, pause the event-worker first: rows written
-- between the copy and the rename would be left in the old table. On a fresh
-- volume docker runs this automatically after 005 and it moves zero rows.
--
-- Existing rows get a generated event_id, so they are never merged with each
-- other. The old data stays in web_vitals_old; drop it once you have checked the
-- new table:  DROP TABLE growth_analytics.web_vitals_old;
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.web_vitals_v2 (
    event_id UUID DEFAULT generateUUIDv4(),
    workspace_id UUID,
    site_id UUID,
    timestamp DateTime64(3, 'UTC'),
    path String,
    metric_name LowCardinality(String), -- 'CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'
    metric_value Float64,
    rating LowCardinality(String), -- 'good', 'needs-improvement', 'poor'
    navigation_type LowCardinality(String) DEFAULT 'navigate'
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (workspace_id, site_id, toDate(timestamp), metric_name, path, event_id);

ALTER TABLE growth_analytics.web_vitals_v2
    MODIFY TTL toDateTime(timestamp) + INTERVAL 24 MONTH DELETE;

ALTER TABLE growth_analytics.web_vitals_v2
    MODIFY SETTING ttl_only_drop_parts = 1;

INSERT INTO growth_analytics.web_vitals_v2
    (workspace_id, site_id, timestamp, path, metric_name, metric_value, rating, navigation_type)
SELECT workspace_id, site_id, timestamp, path, metric_name, metric_value, rating, navigation_type
FROM growth_analytics.web_vitals;

-- Atomic swap: readers see either the old table or the new one, never neither.
RENAME TABLE
    growth_analytics.web_vitals TO growth_analytics.web_vitals_old,
    growth_analytics.web_vitals_v2 TO growth_analytics.web_vitals;
