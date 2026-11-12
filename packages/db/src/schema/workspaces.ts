import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The company that owns this workspace. Every workspace has one. */
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("starter"),
  timezone: text("timezone").notNull().default("UTC"),
  dataRegion: text("data_region").notNull().default("eu-central-1"),
  monthlyEventQuota: integer("monthly_event_quota").notNull().default(100_000),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("idx_workspaces_company_id").on(table.companyId)]);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

