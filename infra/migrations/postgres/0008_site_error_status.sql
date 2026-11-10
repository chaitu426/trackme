CREATE TABLE "site_error_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mode" text DEFAULT 'now' NOT NULL,
	"resolved_at" timestamp with time zone,
	"known_releases" text[] DEFAULT '{}' NOT NULL,
	"regressed_at" timestamp with time zone,
	"regressed_in" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_error_status" ADD CONSTRAINT "site_error_status_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_error_status" ADD CONSTRAINT "site_error_status_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_site_error_status_site_group" ON "site_error_status" USING btree ("site_id","group_id");--> statement-breakpoint
CREATE INDEX "idx_site_error_status_site_status" ON "site_error_status" USING btree ("site_id","status");