-- Rollback of 018. The timeline is derived from events_v2 (which keeps the events for the site's retention period), so
-- re-applying 018 and replaying events rebuilds it. Until then the User 360 timeline is empty; the older People activity
-- list, which reads events directly, keeps working.

DROP VIEW IF EXISTS growth_analytics.mv_user_timeline;
DROP TABLE IF EXISTS growth_analytics.user_timeline;
