CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"invited_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"distinct_id" text NOT NULL,
	"anonymous_id" text,
	"name" text,
	"email" text,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_sessions" integer DEFAULT 1 NOT NULL,
	"total_events" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_user_profiles" ADD CONSTRAINT "site_user_profiles_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_funnels" ADD CONSTRAINT "site_funnels_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_channel_id_alert_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."alert_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_otp_codes_email_purpose" ON "otp_codes" USING btree ("email","purpose");--> statement-breakpoint
CREATE INDEX "idx_otp_codes_expires_at" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_workspace_invites_workspace_id" ON "workspace_invites" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_invites_email" ON "workspace_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_workspace_invites_token" ON "workspace_invites" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_site_user_profiles_site_distinct" ON "site_user_profiles" USING btree ("site_id","distinct_id");--> statement-breakpoint
CREATE INDEX "idx_site_user_profiles_site_last_seen" ON "site_user_profiles" USING btree ("site_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_site_user_profiles_site_email" ON "site_user_profiles" USING btree ("site_id","email");--> statement-breakpoint
CREATE INDEX "idx_site_funnels_site_id" ON "site_funnels" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_alert_channels_workspace_id" ON "alert_channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_alert_rules_site_id" ON "alert_rules" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_alert_rules_channel_id" ON "alert_rules" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_alert_rules_type" ON "alert_rules" USING btree ("type");