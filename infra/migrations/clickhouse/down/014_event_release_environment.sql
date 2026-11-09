-- Rollback of 014: restore the view from migration 008, then drop the columns.
-- Rows already stored lose their release and environment. Same few-millisecond gap as the up migration.

DROP VIEW IF EXISTS growth_analytics.mv_events_ingest;

CREATE MATERIALIZED VIEW growth_analytics.mv_events_ingest
TO growth_analytics.events_v2 AS
SELECT
    event_id,
    site_id,
    workspace_id,
    schema_version,
    timestamp,
    received_at,
    type,
    event_name,
    cityHash64(session_id)        AS session_hash,
    cityHash64(visitor_pseudonym) AS visitor_hash,
    path,
    title,
    referrer,
    domainWithoutWWW(referrer)    AS referrer_domain,
    campaign_source,
    campaign_medium,
    campaign_name,
    campaign_term,
    campaign_content,
    trimBoth(country)             AS country,
    city,
    browser,
    os,
    device,
    bot_status,
    vital_name,
    vital_value,
    vital_rating,
    vital_nav_type,
    properties_json,
    JSONExtractString(properties_json, 'goal') AS goal
FROM growth_analytics.events_ingest;

ALTER TABLE growth_analytics.events_v2
    DROP COLUMN IF EXISTS release,
    DROP COLUMN IF EXISTS environment;

ALTER TABLE growth_analytics.events_ingest
    DROP COLUMN IF EXISTS release,
    DROP COLUMN IF EXISTS environment;
