-- Rollback of 0015: billing records are dropped. Companies keep whatever plan they have now (companies.plan is untouched).
DROP TABLE IF EXISTS "billing_events";
DROP TABLE IF EXISTS "invoices";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "billing_customers";
