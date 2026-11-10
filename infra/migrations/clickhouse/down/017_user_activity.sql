-- Rollback of 017. Views first. The tables are derived from events_v2, so re-applying 017 and replaying the
-- events (a backfill from events_v2) rebuilds them; until then retention charts are empty.

DROP VIEW IF EXISTS growth_analytics.mv_user_event_day;
DROP VIEW IF EXISTS growth_analytics.mv_user_first_day;
DROP VIEW IF EXISTS growth_analytics.mv_user_active_day;

DROP TABLE IF EXISTS growth_analytics.user_event_day;
DROP TABLE IF EXISTS growth_analytics.user_first_day;
DROP TABLE IF EXISTS growth_analytics.user_active_day;
