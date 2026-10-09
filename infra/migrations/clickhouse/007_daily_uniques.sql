-- ==============================================================================
-- ClickHouse Migration: daily distinct-count states
--
-- Visitors and sessions for a long range cannot be summed from per-day counts
-- (a visitor active on three days would count three times), and recomputing them
-- with uniqExact over events_raw scans the whole range on every dashboard load.
--
-- This table stores, per site and UTC day, a compact "state" of the distinct
-- visitor ids and session ids seen that day. States from several days merge into
-- one count across the whole range (uniqCombined64Merge), so a 30-day overview
-- reads 30 small rows instead of 30 days of raw events.
--
-- uniqCombined64 is exact for small sets and within about 1% for very large ones.
--
-- Same recompute-and-replace pattern as the other rollups: the job rewrites
-- recent days on every run, ReplacingMergeTree keeps the newest copy, and readers
-- use FINAL. Run once; CREATE IF NOT EXISTS makes a re-run harmless.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.daily_uniques (
    workspace_id UUID,
    site_id UUID,
    date Date,

    visitors_state AggregateFunction(uniqCombined64, String),
    sessions_state AggregateFunction(uniqCombined64, String),

    inserted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, site_id, date)
TTL toDateTime(date) + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;
