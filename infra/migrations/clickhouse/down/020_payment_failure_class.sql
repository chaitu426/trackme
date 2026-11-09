-- Rollback of 020. The classifications are derived from payment_events and the rule table, so they can be rebuilt: re-apply 020 and
-- the classifier job picks up every failed payment from the last three days again; older failures are not reclassified automatically.
DROP TABLE IF EXISTS growth_analytics.payment_failure_class;
