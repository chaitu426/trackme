-- ==============================================================================
-- ClickHouse Migration: Core Web Vitals
-- Table: web_vitals
-- Engine: MergeTree
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.web_vitals (
    workspace_id UUID,
    site_id UUID,
    timestamp DateTime64(3, 'UTC'),
    path String,
    metric_name LowCardinality(String), -- 'CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'
    metric_value Float64,
    rating LowCardinality(String), -- 'good', 'needs-improvement', 'poor'
    navigation_type LowCardinality(String) DEFAULT 'navigate'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (workspace_id, site_id, toDate(timestamp), metric_name, path);

