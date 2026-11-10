-- Phase 3E: why a refund or dispute happened, and when a dispute must be answered by.
--   reason  the gateway's own code (empty for a plain payment event)
--   due_by  the respond-by time for a dispute; the epoch (1970-01-01) means none
ALTER TABLE growth_analytics.payment_events ADD COLUMN IF NOT EXISTS reason String DEFAULT '';
ALTER TABLE growth_analytics.payment_events ADD COLUMN IF NOT EXISTS due_by DateTime64(3, 'UTC') DEFAULT toDateTime64(0, 3, 'UTC');
