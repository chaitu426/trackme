-- ==============================================================================
-- ClickHouse Migration: release and environment on every event (suite foundation)
--
-- Error Tracking, the Release Impact Report and release filters all need to say which build an
-- event came from and which environment it ran in. Both are optional on the wire; absent means
-- release '' and environment 'production'.
--
--   events_ingest   (Null engine) gets the two input columns.
--   events_v2       gets them as LowCardinality columns (few distinct values, dictionary encoded).
--   mv_events_ingest is recreated to copy them. ClickHouse cannot alter a view's SELECT in place on
--                   every deployment, so it is dropped and created back to back: rows inserted in
--                   those few milliseconds reach no table. Apply with the writer paused, or at a
--                   quiet moment. Aggregate MVs read events_v2 and are not affected.
--
-- Legacy events_raw is untouched: new suite features read events_v2 only.
-- Rollback: down/014_event_release_environment.sql
-- ==============================================================================

ALTER TABLE growth_analytics.events_ingest
    ADD COLUMN IF NOT EXISTS release     String DEFAULT '',
    ADD COLUMN IF NOT EXISTS environment String DEFAULT 'production';

ALTER TABLE growth_analytics.events_v2
    ADD COLUMN IF NOT EXISTS release     LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS environment LowCardinality(String) DEFAULT 'production';

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
    JSONExtractString(properties_json, 'goal') AS goal,
    release,
    environment
FROM growth_analytics.events_ingest;
