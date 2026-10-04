import { pgTable, text, timestamp, uuid, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const siteUserProfiles = pgTable(
  "site_user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    distinctId: text("distinct_id").notNull(),
    anonymousId: text("anonymous_id"),
    name: text("name"),
    email: text("email"),
    traits: jsonb("traits").default({}).notNull(),
    totalSessions: integer("total_sessions").default(1).notNull(),
    totalEvents: integer("total_events").default(1).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_site_user_profiles_site_distinct").on(table.siteId, table.distinctId),
    index("idx_site_user_profiles_site_last_seen").on(table.siteId, table.lastSeenAt),
    index("idx_site_user_profiles_site_email").on(table.siteId, table.email),
  ]
);

export type SiteUserProfile = typeof siteUserProfiles.$inferSelect;
export type NewSiteUserProfile = typeof siteUserProfiles.$inferInsert;
