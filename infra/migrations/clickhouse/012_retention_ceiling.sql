-- ==============================================================================
-- ClickHouse Migration: table TTL becomes a CEILING; per-site retention is enforced by the job
--
-- Every table deleted rows after a fixed 24 months, but a site can choose 12, 24 or 36 months (the job
-- accepts up to 60). A site that chose 36 therefore lost a third of the history it was promised, with no
-- error anywhere. The table TTL now only bounds how long ANY row can live (60 months, the largest value the
-- retention job accepts); services/scheduled-worker/src/jobs/retention.ts deletes earlier, per site, for
-- every site whose retention is shorter (including the 24-month default).
--
-- Raising a TTL only extends life, so nothing is deleted by this migration. ClickHouse re-evaluates the TTL
-- for existing parts in the background (materialize_ttl_after_modify); on very large tables run it off-peak.
-- ==============================================================================

ALTER TABLE growth_analytics.events_raw MODIFY TTL toDateTime(timestamp) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.web_vitals MODIFY TTL toDateTime(timestamp) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.pageview_rollups_hourly MODIFY TTL hour_timestamp + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.pageview_rollups_daily MODIFY TTL toDateTime(date) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.event_rollups_daily MODIFY TTL toDateTime(date) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.session_engagement_daily MODIFY TTL toDateTime(date) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.daily_uniques MODIFY TTL toDateTime(date) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.events_v2 MODIFY TTL toDateTime(timestamp) + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.site_daily_agg MODIFY TTL date + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.session_day_agg MODIFY TTL date + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.dim_daily_agg MODIFY TTL date + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.filter_daily_agg MODIFY TTL date + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.event_daily_agg MODIFY TTL date + INTERVAL 60 MONTH DELETE;
ALTER TABLE growth_analytics.web_vitals_agg MODIFY TTL date + INTERVAL 60 MONTH DELETE;
