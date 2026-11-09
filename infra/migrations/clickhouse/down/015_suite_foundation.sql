-- Rollback of 015. Views first so nothing writes to a table while it is dropped.
-- All of this data is derived from events_v2, so dropping it loses nothing that cannot be rebuilt
-- by re-running the up migration and a backfill from events_v2.

DROP VIEW IF EXISTS growth_analytics.mv_metric_rollup_day;
DROP VIEW IF EXISTS growth_analytics.mv_metric_rollup_hour;
DROP VIEW IF EXISTS growth_analytics.mv_metric_rollup_minute;
DROP VIEW IF EXISTS growth_analytics.mv_session_summary;
DROP VIEW IF EXISTS growth_analytics.mv_identity_map;

DROP TABLE IF EXISTS growth_analytics.metric_rollup_day;
DROP TABLE IF EXISTS growth_analytics.metric_rollup_hour;
DROP TABLE IF EXISTS growth_analytics.metric_rollup_minute;
DROP TABLE IF EXISTS growth_analytics.session_summary_agg;
DROP TABLE IF EXISTS growth_analytics.identity_map;
