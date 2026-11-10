-- Rollback of 019. payment_events is the only copy of the normalised payment history (the raw payloads in the object
-- store are kept 90 days and can be replayed through the adapters). Take a copy first if you need to keep it:
--   INSERT INTO <backup> SELECT * FROM growth_analytics.payment_events
-- order_session is derived from events_v2 and is rebuilt by re-applying 019 and replaying events.

DROP VIEW IF EXISTS growth_analytics.mv_order_session;
DROP TABLE IF EXISTS growth_analytics.order_session;
DROP TABLE IF EXISTS growth_analytics.payment_events;
