-- Rollback of 0007: the release list is rebuilt from the deploy webhook, so nothing else depends on it.
DROP TABLE IF EXISTS "site_releases";
