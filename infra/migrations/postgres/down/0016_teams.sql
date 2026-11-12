-- Rollback of 0016: teams and their grants are dropped, and every workspace goes back to role-only access.
DROP TABLE IF EXISTS "site_user_features";
DROP TABLE IF EXISTS "site_team_features";
DROP TABLE IF EXISTS "team_members";
DROP TABLE IF EXISTS "teams";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "access_mode";
