-- Rollback of 0010: Ask run records are removed; the interface falls back to demo mode until redeployed.
DROP TABLE IF EXISTS "ask_runs";
