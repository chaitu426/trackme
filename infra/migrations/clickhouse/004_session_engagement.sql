-- ==============================================================================
-- Daily session engagement rollups (bounce + duration)
-- Avoids windowed scans of events_raw for long-range overview KPIs.
-- Sessions attributed to the calendar day of session start (UTC).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.session_engagement_daily (
    workspace_id UUID,
    site_id UUID,
    date Date,

    sessions UInt64,
    bounced_sessions UInt64,
    total_duration_seconds UInt64,
    pageviews UInt64,

    inserted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, site_id, date)
TTL toDateTime(date) + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;
