CREATE TABLE "ask_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"site_id" uuid,
	"created_by" uuid,
	"question" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"answer" jsonb,
	"error" text,
	"model" text,
	"tokens" integer,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ask_runs" ADD CONSTRAINT "ask_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_runs" ADD CONSTRAINT "ask_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_runs" ADD CONSTRAINT "ask_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ask_runs_workspace_created" ON "ask_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ask_runs_status" ON "ask_runs" USING btree ("status");