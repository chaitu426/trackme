-- Rollback of 0011: API keys stop recording who created them.
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_created_by_users_id_fk";
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "created_by";
