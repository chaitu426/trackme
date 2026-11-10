-- ==============================================================================
-- ClickHouse Migration: leak_sessions (Phase 3D, the Revenue-Leak Detector)
--
--   One row per browser session that opened the checkout page, per day: did it pay, for how much, and which error groups it
--   saw (from ten minutes before the checkout page opened). Built by an hourly job from that day's events, orders and payments,
--   so the Revenue Leaks page reads this small table and never scans raw events.
--   ReplacingMergeTree on (site, day, session): recomputing a day replaces its rows. Readers use FINAL, scoped to one site and range.
--   Retention: 13 months.
-- Rollback: down/022_leak_sessions.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.leak_sessions
(
    workspace_id UUID,
    site_id      UUID,
    day          Date,
    session_hash UInt64,
    paid         UInt8,
    amount_minor Int64,
    currency     LowCardinality(String),
    error_groups Array(UInt64),
    updated_at   DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(day)
ORDER BY (site_id, day, session_hash)
TTL day + INTERVAL 13 MONTH DELETE;
