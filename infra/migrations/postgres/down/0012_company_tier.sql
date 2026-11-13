-- Rollback of 0012: the company tier is removed. Workspaces keep their own owners (workspace_members is untouched),
-- so nobody loses access; company-level ownership and any workspaces created under a shared company are flattened.
DROP INDEX IF EXISTS "idx_workspaces_company_id";
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_company_id_companies_id_fk";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "company_id";
DROP TABLE IF EXISTS "company_members";
DROP TABLE IF EXISTS "companies";
