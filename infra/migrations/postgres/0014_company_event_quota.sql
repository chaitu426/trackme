ALTER TABLE "companies" ADD COLUMN "monthly_event_quota" integer DEFAULT 50000 NOT NULL;--> statement-breakpoint
-- Existing companies keep exactly what their workspaces were already allowed: the highest quota among them.
UPDATE "companies" c SET "monthly_event_quota" = COALESCE(
  (SELECT MAX(w."monthly_event_quota") FROM "workspaces" w WHERE w."company_id" = c."id"),
  c."monthly_event_quota"
);
