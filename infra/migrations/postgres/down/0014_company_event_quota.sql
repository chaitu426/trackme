-- Rollback of 0014: the edge must be rolled back first (it reads companies.monthly_event_quota), or it will fail to resolve sites.
ALTER TABLE "companies" DROP COLUMN IF EXISTS "monthly_event_quota";
