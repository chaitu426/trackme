CREATE TABLE "site_payment_gateways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"gateway" text NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_payment_gateways" ADD CONSTRAINT "site_payment_gateways_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_site_payment_gateways_site_gateway" ON "site_payment_gateways" USING btree ("site_id","gateway");