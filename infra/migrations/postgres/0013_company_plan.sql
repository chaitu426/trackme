ALTER TABLE "companies" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "grandfathered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Everyone who exists before plans do keeps working: they start on Pro, flagged so billing can tell them apart.
-- New companies take the column default, free. Product decision to revisit before billing goes live.
UPDATE "companies" SET "plan" = 'pro', "grandfathered" = true;
