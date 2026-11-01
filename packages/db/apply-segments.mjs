/**
 * apply-segments.mjs
 *
 * Idempotent: creates the site_segments table (migration 0003) if it is missing.
 * Safe to run more than once; it never alters or drops anything.
 *
 *   node packages/db/apply-segments.mjs
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  for (const f of ["../../.env", "../../apps/web/.env.local", "../../apps/web/.env"]) {
    try {
      const content = readFileSync(new URL(f, import.meta.url), "utf8");
      for (const line of content.split("\n")) {
        const [k, ...rest] = line.split("=");
        if (k?.trim() === "DATABASE_URL") {
          process.env.DATABASE_URL = rest.join("=").trim().replace(/^["']|["']$/g, "");
          break;
        }
      }
    } catch {
      // try the next file
    }
    if (process.env.DATABASE_URL) break;
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);
try {
  const [exists] = await sql`
    SELECT 1 AS ok FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_segments'
  `;
  if (exists) {
    console.log("site_segments already exists, nothing to do.");
  } else {
    await sql`
      CREATE TABLE "site_segments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
        "name" text NOT NULL,
        "definition" jsonb NOT NULL,
        "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_site_segments_site_id" ON "site_segments" ("site_id")`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_site_segments_site_name" ON "site_segments" ("site_id","name")`;
    console.log("Created site_segments.");
  }
} finally {
  await sql.end();
}
