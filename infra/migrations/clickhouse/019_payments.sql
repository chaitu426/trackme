-- ==============================================================================
-- ClickHouse Migration: payments (Phase 3A)
--
--   payment_events   one row per notification from a payment gateway, already normalised (packages/payments).
--                    Money is an integer count of minor units. No card numbers, no UPI ids, no emails or phone numbers:
--                    the adapters drop them before a row is built. ReplacingMergeTree on the gateway's event id, so a
--                    redelivered notification collapses to one row at merge time; readers use FINAL (always scoped to
--                    one site and a date range, so it stays cheap). Retention: 25 months, for financial audit.
--   order_session    which browser session placed which order, so a payment (which the gateway reports with the
--                    merchant's order id) can be tied to the session, user and any errors in it. Filled by a view
--                    from events_v2: any custom event whose properties carry `orderId` (the tracker's trackPayment).
--
-- The raw gateway payloads are not here: they live in the object store for 90 days (payments/<site>/<day>/...).
-- Rollback: down/019_payments.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS growth_analytics.payment_events
(
    workspace_id     UUID,
    site_id          UUID,
    gateway          LowCardinality(String),
    gateway_event_id String,
    payment_id       String,
    order_id         String,
    status           LowCardinality(String),
    amount_minor     Int64,
    currency         LowCardinality(String),
    method           LowCardinality(String),
    failure_code_raw String,
    bank             LowCardinality(String),
    customer_ref     String,
    session_ref      String,
    user_ref         String,
    created_at       DateTime64(3, 'UTC'),
    received_at      DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, toDate(created_at), gateway, gateway_event_id)
TTL toDateTime(created_at) + INTERVAL 25 MONTH DELETE;

CREATE TABLE IF NOT EXISTS growth_analytics.order_session
(
    workspace_id UUID,
    site_id      UUID,
    order_id     String,
    session_hash UInt64,
    user_id      String,
    ts           DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(ts)
ORDER BY (site_id, order_id)
TTL toDateTime(ts) + INTERVAL 25 MONTH DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS growth_analytics.mv_order_session
TO growth_analytics.order_session AS
SELECT
    workspace_id,
    site_id,
    JSONExtractString(properties_json, 'orderId')    AS order_id,
    session_hash,
    JSONExtractString(properties_json, 'distinctId') AS user_id,
    timestamp                                        AS ts
FROM growth_analytics.events_v2
WHERE bot_status = 'human' AND type = 'custom' AND order_id != '';
