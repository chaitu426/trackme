/**
 * apply-new-tables.mjs
 * 
 * Idempotent script that creates only the new tables introduced in migration 0001
 * that don't already exist in the DB, then marks 0001 as applied in drizzle's
 * __drizzle_migrations table.
 * 
 * Run with:
 *   node apply-new-tables.mjs
 */

import postgres from "postgres";
import { readFileSync } from "fs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // Try to load from .env files
  const envFiles = [
    "../../apps/web/.env.local",
    "../../apps/web/.env",
    "../../.env",
  ];
  for (const f of envFiles) {
    try {
      const content = readFileSync(new URL(f, import.meta.url), "utf8");
      for (const line of content.split("\n")) {
        const [k, ...rest] = line.split("=");
        if (k?.trim() === "DATABASE_URL") {
          process.env.DATABASE_URL = rest.join("=").trim().replace(/^["']|["']$/g, "");
          break;
        }
      }
    } catch {}
    if (process.env.DATABASE_URL) break;
  }
}

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not found");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);

async function tableExists(name) {
  const rows = await sql`
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = ${name}
  `;
  return rows.length > 0;
}

async function columnExists(table, column) {
  const rows = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows.length > 0;
}

async function run() {
  console.log("🚀 Applying missing tables from migration 0001...\n");

  // sessions
  if (!(await tableExists("sessions"))) {
    await sql`
      CREATE TABLE "sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "token_hash" text NOT NULL UNIQUE,
        "user_agent" text,
        "ip_address" text,
        "revoked" boolean DEFAULT false NOT NULL,
        "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("user_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_sessions_token_hash" ON "sessions" ("token_hash")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_sessions_expires_at" ON "sessions" ("expires_at")`;
    console.log("  ✓ Created: sessions");
  } else {
    console.log("  ⏭  Skipped: sessions (exists)");
  }

  // otp_codes
  if (!(await tableExists("otp_codes"))) {
    await sql`
      CREATE TABLE "otp_codes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid REFERENCES "users"("id") ON DELETE cascade,
        "email" text NOT NULL,
        "code_hash" text NOT NULL,
        "purpose" text NOT NULL,
        "attempts" integer DEFAULT 0 NOT NULL,
        "used" boolean DEFAULT false NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_otp_codes_email_purpose" ON "otp_codes" ("email","purpose")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_otp_codes_expires_at" ON "otp_codes" ("expires_at")`;
    console.log("  ✓ Created: otp_codes");
  } else {
    console.log("  ⏭  Skipped: otp_codes (exists)");
  }

  // workspace_invites
  if (!(await tableExists("workspace_invites"))) {
    await sql`
      CREATE TABLE "workspace_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
        "email" text NOT NULL,
        "role" text DEFAULT 'member' NOT NULL,
        "token" text NOT NULL UNIQUE,
        "invited_by" uuid REFERENCES "users"("id") ON DELETE set null,
        "status" text DEFAULT 'pending' NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_workspace_invites_workspace_id" ON "workspace_invites" ("workspace_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_workspace_invites_email" ON "workspace_invites" ("email")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_workspace_invites_token" ON "workspace_invites" ("token")`;
    console.log("  ✓ Created: workspace_invites");
  } else {
    console.log("  ⏭  Skipped: workspace_invites (exists)");
  }

  // site_user_profiles
  if (!(await tableExists("site_user_profiles"))) {
    await sql`
      CREATE TABLE "site_user_profiles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
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
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_site_user_profiles_site_distinct" ON "site_user_profiles" ("site_id","distinct_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_site_user_profiles_site_last_seen" ON "site_user_profiles" ("site_id","last_seen_at")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_site_user_profiles_site_email" ON "site_user_profiles" ("site_id","email")`;
    console.log("  ✓ Created: site_user_profiles");
  } else {
    console.log("  ⏭  Skipped: site_user_profiles (exists)");
  }

  // site_funnels
  if (!(await tableExists("site_funnels"))) {
    await sql`
      CREATE TABLE "site_funnels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
        "name" text NOT NULL,
        "description" text,
        "steps" jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_site_funnels_site_id" ON "site_funnels" ("site_id")`;
    console.log("  ✓ Created: site_funnels");
  } else {
    console.log("  ⏭  Skipped: site_funnels (exists)");
  }

  // alert_channels
  if (!(await tableExists("alert_channels"))) {
    await sql`
      CREATE TABLE "alert_channels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
        "name" text NOT NULL,
        "type" text NOT NULL,
        "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "last_tested_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_alert_channels_workspace_id" ON "alert_channels" ("workspace_id")`;
    console.log("  ✓ Created: alert_channels");
  } else {
    console.log("  ⏭  Skipped: alert_channels (exists)");
  }

  // alert_rules
  if (!(await tableExists("alert_rules"))) {
    await sql`
      CREATE TABLE "alert_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
        "channel_id" uuid NOT NULL REFERENCES "alert_channels"("id") ON DELETE cascade,
        "type" text NOT NULL,
        "name" text NOT NULL,
        "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "cooldown_minutes" integer DEFAULT 60 NOT NULL,
        "last_fired_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS "idx_alert_rules_site_id" ON "alert_rules" ("site_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_alert_rules_channel_id" ON "alert_rules" ("channel_id")`;
    await sql`CREATE INDEX IF NOT EXISTS "idx_alert_rules_type" ON "alert_rules" ("type")`;
    console.log("  ✓ Created: alert_rules");
  } else {
    console.log("  ⏭  Skipped: alert_rules (exists)");
  }

  // ── Add new columns to users table ────────────────────────────────────────
  const userNewCols = [
    { col: "email_verified", ddl: `ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL` },
    { col: "totp_secret",    ddl: `ALTER TABLE "users" ADD COLUMN "totp_secret" text` },
    { col: "totp_enabled",   ddl: `ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL` },
    { col: "failed_login_attempts", ddl: `ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL` },
    { col: "locked_until",   ddl: `ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone` },
  ];

  for (const { col, ddl } of userNewCols) {
    if (!(await columnExists("users", col))) {
      await sql.unsafe(ddl);
      console.log(`  ✓ Added column: users.${col}`);
    } else {
      console.log(`  ⏭  Skipped: users.${col} (exists)`);
    }
  }

  // ── Mark migration 0001 as applied in drizzle tracking table ──────────────
  const checkApplied = await sql`
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash IS NOT NULL
  `.catch(() => []);

  // Insert migration record if not present
  try {
    const rows = await sql`SELECT tag FROM drizzle.__drizzle_migrations`;
    const tags = rows.map(r => r.tag);
    if (!tags.includes("0001_goofy_wind_dancer")) {
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES ('0001_goofy_wind_dancer', ${Date.now()})
      `;
      console.log("\n  ✓ Marked migration 0001 as applied in __drizzle_migrations");
    } else {
      console.log("\n  ⏭  Migration 0001 already tracked");
    }
  } catch (e) {
    console.log("\n  ⚠️  Could not update migration tracking table (non-fatal):", e.message);
  }

  await sql.end();
  console.log("\n✅ Done! All tables are now in sync.");
}

run().catch((err) => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
