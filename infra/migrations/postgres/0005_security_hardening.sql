-- Security hardening (docs/SECURITY_AUDIT.md: C1, H1, M6).
--
-- 1. Invitations. Until now an invite token was returned by the API to every workspace member, and accepting
--    one signed the holder in as the invited account. Every pending token must be treated as exposed, so all
--    pending invitations are revoked; workspace admins can send fresh ones (those tokens are only ever emailed).
UPDATE "workspace_invites" SET "status" = 'revoked' WHERE "status" = 'pending';--> statement-breakpoint

-- 2. Pre-registered accounts. Sign-up used to create an account before the email was verified, and let anyone
--    replace the password of an unverified one, so a password on an unverified account may belong to someone
--    other than the address's owner. Accounts are now created only after the code is entered. Unverified
--    accounts with no workspace are removed; the few that hold a membership keep it but lose their password,
--    and recover by signing up again with the same address (which verifies it and sets a new password).
DELETE FROM "users" u
WHERE u."email_verified" = false
  AND NOT EXISTS (SELECT 1 FROM "workspace_members" m WHERE m."user_id" = u."id");--> statement-breakpoint
UPDATE "users" SET "password_hash" = NULL WHERE "email_verified" = false;--> statement-breakpoint

-- 3. Public dashboard lookup. The unauthenticated /share/{slug} page filtered an unindexed JSON field, so every
--    request scanned the sites table.
CREATE INDEX IF NOT EXISTS "idx_sites_public_dashboard_slug" ON "sites" ((("settings" ->> 'publicDashboardSlug')));
