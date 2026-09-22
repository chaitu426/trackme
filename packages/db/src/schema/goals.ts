import { pgTable, text, timestamp, uuid, boolean, numeric, index } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { workspaces } from "./workspaces.js";

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'pageview_rule' | 'custom_event'
    eventName: text("event_name"),
    pathPattern: text("path_pattern"),
    targetValue: numeric("target_value", { precision: 12, scale: 2 }),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_goals_site_id").on(table.siteId),
    index("idx_goals_workspace_id").on(table.workspaceId),
  ]
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;

