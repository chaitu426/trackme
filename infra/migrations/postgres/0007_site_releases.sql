CREATE TABLE "site_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"version" text NOT NULL,
	"commit" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"deployed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_releases" ADD CONSTRAINT "site_releases_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_site_releases_site_version_env" ON "site_releases" USING btree ("site_id","version","environment");--> statement-breakpoint
CREATE INDEX "idx_site_releases_site_deployed" ON "site_releases" USING btree ("site_id","deployed_at");