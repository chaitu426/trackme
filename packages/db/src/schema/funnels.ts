import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export interface FunnelStep {
  order: number;
  name: string;
  type: "pageview" | "custom_event";
  target: string; // e.g. path "/pricing" or event name "signup_completed"
}

export const siteFunnels = pgTable(
  "site_funnels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    steps: jsonb("steps").$type<FunnelStep[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_site_funnels_site_id").on(table.siteId),
  ]
);

export type SiteFunnel = typeof siteFunnels.$inferSelect;
export type NewSiteFunnel = typeof siteFunnels.$inferInsert;
