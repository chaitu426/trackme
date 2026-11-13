import { pgTable, text, timestamp, uuid, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";
import { sites } from "./sites.js";

/** A group of people in a workspace (Marketing, Engineering, QA...). What a team may see is set per site. */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    leadUserId: uuid("lead_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("idx_teams_workspace_slug").on(table.workspaceId, table.slug)]
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // 'lead' | 'member'
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] }), index("idx_team_members_user").on(table.userId)]
);

/** What a team may use on a site: one row per feature, level 'view' or 'manage'. No row means no access. */
export const siteTeamFeatures = pgTable(
  "site_team_features",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    level: text("level").notNull(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.teamId, table.feature] }), index("idx_site_team_features_team").on(table.teamId)]
);

/** The same for one person, on top of their teams. */
export const siteUserFeatures = pgTable(
  "site_user_features",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    level: text("level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.userId, table.feature] }), index("idx_site_user_features_user").on(table.userId)]
);

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
