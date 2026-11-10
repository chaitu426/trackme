-- Rollback of 021: the reason and deadline columns are dropped. Refunds and disputes keep their amounts and status; only
-- their reasons and dispute deadlines are lost, and they come back by replaying the raw payloads kept for 90 days.
ALTER TABLE growth_analytics.payment_events DROP COLUMN IF EXISTS due_by;
ALTER TABLE growth_analytics.payment_events DROP COLUMN IF EXISTS reason;
