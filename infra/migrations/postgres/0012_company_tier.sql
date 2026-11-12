CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_members_company_id_user_id_pk" PRIMARY KEY("company_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_company_members_user_id" ON "company_members" USING btree ("user_id");--> statement-breakpoint
-- Add the column empty, fill it, then make it required: existing rows must not block the migration.
ALTER TABLE "workspaces" ADD COLUMN "company_id" uuid;--> statement-breakpoint
-- Backfill: every existing workspace gets a company of its own, named after it. The company reuses the
-- workspace's id, so the mapping is exact and nothing needs a lookup table.
INSERT INTO "companies" ("id", "name", "created_at", "updated_at")
SELECT "id", "name", "created_at", now() FROM "workspaces";--> statement-breakpoint
UPDATE "workspaces" SET "company_id" = "id" WHERE "company_id" IS NULL;--> statement-breakpoint
-- The workspace's current owner becomes the company's owner. Behaviour is unchanged: they already owned it.
INSERT INTO "company_members" ("company_id", "user_id", "role")
SELECT "workspace_id", "user_id", 'owner' FROM "workspace_members" WHERE "role" = 'owner'
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workspaces_company_id" ON "workspaces" USING btree ("company_id");
