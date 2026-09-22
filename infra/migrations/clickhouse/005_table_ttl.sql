-- ==============================================================================
-- Production retention: table TTL (prefer part drops over DELETE mutations).
-- DEFAULT_RETENTION_MONTHS = 24. scheduled-worker also DROP PARTITIONs monthly.
-- ==============================================================================

ALTER TABLE growth_analytics.events_raw
    MODIFY TTL toDateTime(timestamp) + INTERVAL 24 MONTH DELETE;

ALTER TABLE growth_analytics.events_raw
    MODIFY SETTING ttl_only_drop_parts = 1;

ALTER TABLE growth_analytics.web_vitals
    MODIFY TTL toDateTime(timestamp) + INTERVAL 24 MONTH DELETE;

ALTER TABLE growth_analytics.web_vitals
    MODIFY SETTING ttl_only_drop_parts = 1;

ALTER TABLE growth_analytics.pageview_rollups_hourly
    MODIFY TTL hour_timestamp + INTERVAL 24 MONTH DELETE;

ALTER TABLE growth_analytics.pageview_rollups_hourly
    MODIFY SETTING ttl_only_drop_parts = 1;

ALTER TABLE growth_analytics.pageview_rollups_daily
    MODIFY TTL toDateTime(date) + INTERVAL 24 MONTH DELETE;

ALTER TABLE growth_analytics.pageview_rollups_daily
    MODIFY SETTING ttl_only_drop_parts = 1;

ALTER TABLE growth_analytics.event_rollups_daily
    MODIFY TTL toDateTime(date) + INTERVAL 24 MONTH DELETE;

ALTER TABLE growth_analytics.event_rollups_daily
    MODIFY SETTING ttl_only_drop_parts = 1;
