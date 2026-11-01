import { pgTable, text, timestamp, uuid, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { users } from "./users.js";

/**
 * A saved filter over a site's identified users. The definition is validated and
 * evaluated by the web app (apps/web/src/lib/segments.ts), so its shape can grow without
 * a migration.
 */
export const siteSegments = pgTable(
  "site_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<unknown>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_site_segments_site_id").on(table.siteId),
    uniqueIndex("idx_site_segments_site_name").on(table.siteId, table.name),
  ]
);

export type SiteSegment = typeof siteSegments.$inferSelect;
export type NewSiteSegment = typeof siteSegments.$inferInsert;
