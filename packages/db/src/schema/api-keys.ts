import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";
import { users } from "./users.js";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Who created the key. Null for keys made before this was recorded, or after that person was deleted. */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // e.g. gip_live_ab12
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(), // ['read:analytics', 'write:events']
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_api_keys_workspace_id").on(table.workspaceId),
  ]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

