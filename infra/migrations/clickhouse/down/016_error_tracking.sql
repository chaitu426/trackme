-- Rollback of 016. Views first. Error events, groups and occurrences are lost: the source events stay in
-- events_v2 (type = 'error', with groupId in properties_json), but the stacks and breadcrumbs exist only here.

DROP VIEW IF EXISTS growth_analytics.mv_error_group_daily;
DROP VIEW IF EXISTS growth_analytics.mv_error_groups;
DROP VIEW IF EXISTS growth_analytics.mv_error_ingest;

DROP TABLE IF EXISTS growth_analytics.error_occurrences;
DROP TABLE IF EXISTS growth_analytics.error_group_daily;
DROP TABLE IF EXISTS growth_analytics.error_groups;
DROP TABLE IF EXISTS growth_analytics.error_events;
DROP TABLE IF EXISTS growth_analytics.error_ingest;
