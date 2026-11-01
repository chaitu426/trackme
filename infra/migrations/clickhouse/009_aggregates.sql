-- ==============================================================================
-- ClickHouse Migration: incremental aggregates (optimization plan WS3)
--
-- Each table is an AggregatingMergeTree fed by a materialized view on events_v2,
-- so numbers are computed once at insert time. Readers never use FINAL: they
-- re-aggregate (sum, uniqCombined64Merge), which is correct before and after
-- background merges.
--
-- Semantics match the legacy rollups: human traffic only (bot_status = 'human'),
-- distinct counts merged from states and never summed across days, UTC days.
--
-- Do NOT insert into these tables by hand: sum columns would double count.
-- Repair a day by rebuilding a shadow table and REPLACE PARTITION.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.site_daily_agg
(
    site_id      UUID,
    workspace_id UUID,
    date         Date,
    pageviews    SimpleAggregateFunction(sum, UInt64),
    events       SimpleAggregateFunction(sum, UInt64),
    visitors     AggregateFunction(uniqCombined64, UInt64),
    sessions     AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, workspace_id, date)
TTL date + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_site_daily
TO growth_analytics.site_daily_agg AS
SELECT
    site_id,
    workspace_id,
    toDate(timestamp)                    AS date,
    toUInt64(countIf(type = 'pageview')) AS pageviews,
    toUInt64(count())                    AS events,
    uniqCombined64State(visitor_hash)    AS visitors,
    uniqCombined64State(session_hash)    AS sessions
FROM growth_analytics.events_v2
WHERE bot_status = 'human'
GROUP BY site_id, workspace_id, date;

-- One row per session-day: bounce rate and duration read this small table.
CREATE TABLE IF NOT EXISTS growth_analytics.session_day_agg
(
    site_id      UUID,
    date         Date,
    session_hash UInt64,
    first_ts     SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_ts      SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    pageviews    SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, session_hash)
TTL date + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_session_day
TO growth_analytics.session_day_agg AS
SELECT
    site_id,
    toDate(timestamp)                    AS date,
    session_hash,
    min(timestamp)                       AS first_ts,
    max(timestamp)                       AS last_ts,
    toUInt64(countIf(type = 'pageview')) AS pageviews
FROM growth_analytics.events_v2
WHERE bot_status = 'human'
GROUP BY site_id, date, session_hash;

-- One table for every single-dimension breakdown. dim uses the same names as the
-- BreakdownDimension type in packages/analytics.
CREATE TABLE IF NOT EXISTS growth_analytics.dim_daily_agg
(
    site_id   UUID,
    date      Date,
    dim       LowCardinality(String),
    value     String,
    pageviews SimpleAggregateFunction(sum, UInt64),
    visitors  AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, dim, date, value)
TTL date + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_dim_daily
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
WHERE bot_status = 'human'
GROUP BY site_id, date, dim, value;

-- Wide table for the rare multi-filter queries (referrer reduced to its domain).
CREATE TABLE IF NOT EXISTS growth_analytics.filter_daily_agg
(
    site_id          UUID,
    date             Date,
    path             String,
    referrer_domain  LowCardinality(String),
    country          LowCardinality(String),
    browser          LowCardinality(String),
    os               LowCardinality(String),
    device           LowCardinality(String),
    campaign_source  LowCardinality(String),
    campaign_medium  LowCardinality(String),
    campaign_name    LowCardinality(String),
    pageviews        SimpleAggregateFunction(sum, UInt64),
    visitors         AggregateFunction(uniqCombined64, UInt64),
    sessions         AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, path, referrer_domain, country, browser, os, device, campaign_source, campaign_medium, campaign_name)
TTL date + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_filter_daily
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
WHERE bot_status = 'human'
GROUP BY site_id, date, path, referrer_domain, country, browser, os, device,
         campaign_source, campaign_medium, campaign_name;

-- Custom events per day.
CREATE TABLE IF NOT EXISTS growth_analytics.event_daily_agg
(
    site_id     UUID,
    date        Date,
    event_name  LowCardinality(String),
    total_count SimpleAggregateFunction(sum, UInt64),
    sessions    AggregateFunction(uniqCombined64, UInt64),
    visitors    AggregateFunction(uniqCombined64, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, event_name)
TTL date + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_event_daily
TO growth_analytics.event_daily_agg AS
SELECT
    site_id,
    toDate(timestamp)                 AS date,
    event_name,
    toUInt64(count())                 AS total_count,
    uniqCombined64State(session_hash) AS sessions,
    uniqCombined64State(visitor_hash) AS visitors
FROM growth_analytics.events_v2
WHERE type = 'custom' AND bot_status = 'human'
GROUP BY site_id, date, event_name;

-- Web vitals: replaces the second insert and FINAL on the legacy table.
CREATE TABLE IF NOT EXISTS growth_analytics.web_vitals_agg
(
    site_id UUID,
    date    Date,
    path    String,
    metric  LowCardinality(String),
    samples SimpleAggregateFunction(sum, UInt64),
    good    SimpleAggregateFunction(sum, UInt64),
    needs   SimpleAggregateFunction(sum, UInt64),
    poor    SimpleAggregateFunction(sum, UInt64),
    q       AggregateFunction(quantilesTDigest(0.5, 0.75, 0.95), Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (site_id, date, metric, path)
TTL date + INTERVAL 24 MONTH DELETE
SETTINGS ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_web_vitals
TO growth_analytics.web_vitals_agg AS
SELECT
    site_id,
    toDate(timestamp)                                     AS date,
    path,
    vital_name                                            AS metric,
    toUInt64(count())                                     AS samples,
    toUInt64(countIf(vital_rating = 'good'))              AS good,
    toUInt64(countIf(vital_rating = 'needs-improvement')) AS needs,
    toUInt64(countIf(vital_rating = 'poor'))              AS poor,
    quantilesTDigestState(0.5, 0.75, 0.95)(vital_value)   AS q
FROM growth_analytics.events_v2
WHERE type = 'web_vital' AND bot_status = 'human'
GROUP BY site_id, date, path, metric;
