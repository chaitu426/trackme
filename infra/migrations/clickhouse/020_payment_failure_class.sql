-- ==============================================================================
-- ClickHouse Migration: payment_failure_class (Phase 3C, the Payment Failure Doctor)
--
--   One row per failed payment, written by the classifier job (services/scheduled-worker) a minute or so after the failure.
--   category and rule_id say what the failure was and which rule decided it; the context columns keep the evidence the
--   rule looked at (an error in the same session, the gateway's success rate at the time, how long the attempt took),
--   so a number on a dashboard can always be explained. rules_version tells rows made by an older rule table from newer ones.
--   ReplacingMergeTree on (site, day, payment): classifying the same payment twice leaves one row; readers use FINAL, always
--   scoped to one site and a date range. Retention: 25 months, like payment_events.
-- Rollback: down/020_payment_failure_class.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.payment_failure_class
(
    workspace_id     UUID,
    site_id          UUID,
    payment_id       String,
    order_id         String,
    gateway          LowCardinality(String),
    method           LowCardinality(String),
    amount_minor     Int64,
    currency         LowCardinality(String),
    failure_code_raw String,
    user_ref         String,
    failed_at        DateTime64(3, 'UTC'),
    category         LowCardinality(String),
    rule_id          LowCardinality(String),
    rules_version    LowCardinality(String),
    session_error    UInt8,
    gateway_rate     Float32,
    gateway_volume   UInt32,
    seconds_to_fail  Float32,
    classified_at    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(classified_at)
PARTITION BY toYYYYMM(failed_at)
ORDER BY (site_id, toDate(failed_at), payment_id)
TTL toDateTime(failed_at) + INTERVAL 25 MONTH DELETE;
