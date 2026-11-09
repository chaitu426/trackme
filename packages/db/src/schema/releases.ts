import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

/**
 * A build that went live on a site, from the deploy webhook (POST /api/v1/deploys). The Release Impact
 * Report compares the hours before and after `deployedAt`; error filters list these versions. A few rows
 * per site per week, so it lives in Postgres with the rest of the control plane, not in ClickHouse.
 */
export const siteReleases = pgTable(
  "site_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    commit: text("commit"),
    environment: text("environment").notNull().default("production"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_site_releases_site_version_env").on(table.siteId, table.version, table.environment),
    index("idx_site_releases_site_deployed").on(table.siteId, table.deployedAt),
  ]
);

export type SiteRelease = typeof siteReleases.$inferSelect;
export type NewSiteRelease = typeof siteReleases.$inferInsert;
