import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";
import { users } from "./users.js";

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    token: text("token").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_workspace_invites_workspace_id").on(table.workspaceId),
    index("idx_workspace_invites_email").on(table.email),
    index("idx_workspace_invites_token").on(table.token),
  ]
);

export type WorkspaceInvite = typeof workspaceInvites.$inferSelect;
export type NewWorkspaceInvite = typeof workspaceInvites.$inferInsert;
