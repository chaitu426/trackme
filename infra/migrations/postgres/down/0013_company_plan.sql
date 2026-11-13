-- Rollback of 0013: plans are forgotten, every company is unrestricted again.
ALTER TABLE "companies" DROP COLUMN IF EXISTS "grandfathered";
ALTER TABLE "companies" DROP COLUMN IF EXISTS "plan";
