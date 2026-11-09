-- Rollback of 0008: issue decisions (resolved/ignored) are lost and every issue shows as open again.
DROP TABLE IF EXISTS "site_error_status";
