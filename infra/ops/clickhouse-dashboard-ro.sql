-- ==============================================================================
-- Read-only ClickHouse user for the web app's dashboard queries (plan WS4.3).
--
-- NOT in infra/migrations on purpose: that directory is applied automatically and
-- must not contain a real password. Run once per environment as an admin, with a
-- generated password, then set CLICKHOUSE_DASHBOARD_USER / _PASSWORD on the web app.
--
-- readonly = 2 (not 1): reads only, but the HTTP client may still send per-query
-- settings (response compression, optimize_aggregation_in_order). readonly = 1
-- rejects those with "Cannot modify setting in readonly mode".
--
-- The limits are starting points. Set them from the p99 of real queries
-- (system.query_log) and revisit after the aggregate tables are in use.
-- ==============================================================================

CREATE SETTINGS PROFILE IF NOT EXISTS dashboard_ro SETTINGS
    readonly = 2,
    max_execution_time = 10,
    max_memory_usage = 2000000000,
    max_rows_to_read = 500000000,
    max_result_rows = 100000,
    result_overflow_mode = 'throw',
    max_bytes_before_external_group_by = 1000000000,
    max_concurrent_queries_for_user = 20;

CREATE USER IF NOT EXISTS dashboard_ro IDENTIFIED BY '<generate-a-strong-password>' SETTINGS PROFILE 'dashboard_ro';

GRANT SELECT ON growth_analytics.* TO dashboard_ro;
