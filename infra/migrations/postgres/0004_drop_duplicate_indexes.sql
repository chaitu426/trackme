-- A UNIQUE column already has a unique index. These three columns also had a second, plain index on the
-- same column, which doubles the write cost (sessions is the highest-write table) and the disk for nothing.
-- The unique indexes (sessions_token_hash_unique, api_keys_key_hash_unique, workspace_invites_token_unique)
-- keep serving every lookup.
DROP INDEX IF EXISTS "idx_sessions_token_hash";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_api_keys_hash";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_workspace_invites_token";
