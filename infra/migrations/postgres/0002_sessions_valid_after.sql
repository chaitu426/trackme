ALTER TABLE "users" ADD COLUMN "sessions_valid_after" timestamp with time zone DEFAULT 'epoch' NOT NULL;
