import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { users } from "./users.js";

/**
 * What a person decided about an error issue. The issue itself (its counts, title, releases) lives in ClickHouse
 * and is derived from events; only this decision is mutable, so only this lives here. A row exists once someone
 * resolves or ignores an issue; no row means open.
 *
 * `groupId` is the 64-bit group id as a decimal string: it does not fit a signed bigint.
 */
export const siteErrorStatus = pgTable(
  "site_error_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull(),
    /** open | resolved | ignored */
    status: text("status").notNull().default("open"),
    /** now: any new occurrence reopens it. next_release: old builds still in the wild may keep raising it. */
    mode: text("mode").notNull().default("now"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Releases the issue had been seen in when it was resolved; a "next_release" resolve reopens only for a release not listed. */
    knownReleases: text("known_releases").array().notNull().default([]),
    regressedAt: timestamp("regressed_at", { withTimezone: true }),
    regressedIn: text("regressed_in"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_site_error_status_site_group").on(table.siteId, table.groupId),
    index("idx_site_error_status_site_status").on(table.siteId, table.status),
  ]
);

export type SiteErrorStatus = typeof siteErrorStatus.$inferSelect;
export type NewSiteErrorStatus = typeof siteErrorStatus.$inferInsert;
