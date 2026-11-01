-- ==============================================================================
-- ClickHouse Migration: engaged sessions (bounce and duration)
--
-- Bounce is now "not engaged" (see packages/analytics/src/queries/engagement-sql.ts):
-- fewer than two pageviews, under 10 s of active time and no custom event. Active time
-- arrives as `engagement` events with properties.engagementMs.
--
-- Only the v2 aggregates need a migration. events_raw reads the new fields straight from
-- properties_json. Run before deploying the tracker if you read v2 (ANALYTICS_READ=v2).
--
-- session_day_agg: two new summed columns, and mv_session_day recreated to fill them.
-- Rows written before this migration have 0 for both, so their sessions count as engaged
-- only by pageviews. This is test data: TRUNCATE the table or re-run
-- scripts/backfill-events-v2.ts if you want it recomputed.
-- ==============================================================================

ALTER TABLE growth_analytics.session_day_agg
    ADD COLUMN IF NOT EXISTS engaged_ms SimpleAggregateFunction(sum, UInt64) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS actions    SimpleAggregateFunction(sum, UInt64) DEFAULT 0;

DROP VIEW IF EXISTS growth_analytics.mv_session_day;

CREATE MATERIALIZED VIEW growth_analytics.mv_session_day
TO growth_analytics.session_day_agg AS
SELECT
    site_id,
    toDate(timestamp)                    AS date,
    session_hash,
    min(timestamp)                       AS first_ts,
    max(timestamp)                       AS last_ts,
    toUInt64(countIf(type = 'pageview')) AS pageviews,
    toUInt64(sumIf(JSONExtractUInt(properties_json, 'engagementMs'), type = 'engagement')) AS engaged_ms,
    toUInt64(countIf(type = 'custom' AND event_name NOT IN ('scroll_depth', 'outbound_click', 'file_download'))) AS actions
FROM growth_analytics.events_v2
WHERE bot_status = 'human'
GROUP BY site_id, date, session_hash;

-- ==============================================================================
-- Breakdowns count visitors by page view only.
--
-- Every other event a visitor sends (web vitals, engagement pings, custom events) has no
-- referrer or campaign of its own, so counting those put every visitor in "(direct / none)"
-- as well as under their real source. mv_dim_daily and mv_filter_daily now see page views
-- only. Pageview counts are unchanged; the visitor and session states shrink to visitors
-- who viewed a page. Existing rows keep the old states: TRUNCATE dim_daily_agg and
-- filter_daily_agg and re-run scripts/backfill-events-v2.ts to recompute them.
-- ==============================================================================

DROP VIEW IF EXISTS growth_analytics.mv_dim_daily;

CREATE MATERIALIZED VIEW growth_analytics.mv_dim_daily
TO growth_analytics.dim_daily_agg AS
SELECT
    site_id,
    toDate(timestamp)                    AS date,
    d.1                                  AS dim,
    d.2                                  AS value,
    toUInt64(countIf(type = 'pageview')) AS pageviews,
    uniqCombined64State(visitor_hash)    AS visitors
FROM growth_analytics.events_v2
ARRAY JOIN [
    ('path',            toString(path)),
    ('referrer',        toString(referrer_domain)),
    ('country',         toString(country)),
    ('browser',         toString(browser)),
    ('os',              toString(os)),
    ('device',          toString(device)),
    ('campaign_source', toString(campaign_source)),
    ('campaign_medium', toString(campaign_medium)),
    ('campaign_name',   toString(campaign_name))
] AS d
WHERE bot_status = 'human' AND type = 'pageview'
GROUP BY site_id, date, dim, value;

DROP VIEW IF EXISTS growth_analytics.mv_filter_daily;

CREATE MATERIALIZED VIEW growth_analytics.mv_filter_daily
TO growth_analytics.filter_daily_agg AS
SELECT
    site_id,
    toDate(timestamp)                    AS date,
    path,
    referrer_domain,
    country,
    browser,
    os,
    device,
    campaign_source,
    campaign_medium,
    campaign_name,
    toUInt64(countIf(type = 'pageview')) AS pageviews,
    uniqCombined64State(visitor_hash)    AS visitors,
    uniqCombined64State(session_hash)    AS sessions
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND type = 'pageview'
GROUP BY site_id, date, path, referrer_domain, country, browser, os, device,
         campaign_source, campaign_medium, campaign_name;
