import { pgTable, text, timestamp, uuid, primaryKey, index, boolean, integer } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * The tier above workspaces: the business that owns one or more workspaces. It holds ownership now and, in a
 * later phase, the plan and billing. A founder creates a company, then workspaces under it.
 */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** 'free' | 'pro'. Billing (a later phase) changes it; limits come from `PLANS` in contracts. */
  plan: text("plan").notNull().default("free"),
  /** Set for companies that existed before plans did: they keep Pro while the beta runs. */
  grandfathered: boolean("grandfathered").notNull().default(false),
  /**
   * Events per month the edge accepts across every workspace of the company, margin included. Derived from the
   * plan (`eventQuotaFor`); applyPlan keeps it in step.
   */
  monthlyEventQuota: integer("monthly_event_quota").notNull().default(50_000),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const companyMembers = pgTable(
  "company_members",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // 'owner' | 'billing_admin'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.userId] }),
    index("idx_company_members_user_id").on(table.userId),
  ]
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyMember = typeof companyMembers.$inferSelect;
