-- Rollback of 0009: connected gateways and their stored webhook secrets are removed; webhooks then answer 404 until reconnected.
DROP TABLE IF EXISTS "site_payment_gateways";
