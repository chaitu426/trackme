import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    displayName: text("display_name").notNull(),
    publicKey: text("public_key").notNull().unique(),
    publicKeyHash: text("public_key_hash").notNull(),
    settings: jsonb("settings").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_sites_workspace_id").on(table.workspaceId),
    index("idx_sites_public_key_hash").on(table.publicKeyHash),
  ]
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

