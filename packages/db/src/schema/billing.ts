import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/** The payment provider's record of a company as a customer. One per company. */
export const billingCustomers = pgTable("billing_customers", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // 'demo' | 'stripe' | 'razorpay'
  providerCustomerId: text("provider_customer_id").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A company's subscription. At most one row per company, kept after it ends so a second free trial cannot be taken.
 * Statuses: trialing, active, past_due, canceled. The plan a company has is derived from this row (see `planFor`).
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'internal' for a trial with no card
    providerSubscriptionId: text("provider_subscription_id"),
    plan: text("plan").notNull().default("pro"),
    interval: text("interval").notNull().default("month"), // 'month' | 'year'
    status: text("status").notNull(),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** While past_due: Pro stays until this moment, then the company drops to Free. */
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    /** The newest provider event applied; an older event arriving later is ignored. */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("idx_subscriptions_company").on(table.companyId), index("idx_subscriptions_status").on(table.status)]
);

/** Money is in minor units (cents) with an explicit currency. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id").notNull(),
    number: text("number").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(), // 'paid' | 'failed' | 'refunded'
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_invoices_provider_invoice").on(table.provider, table.providerInvoiceId),
    index("idx_invoices_company_created").on(table.companyId, table.createdAt),
  ]
);

/** Every provider event we have received. The unique key makes processing idempotent; the payload is the audit record. */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull(),
    /** 'applied' | 'ignored_stale' | 'ignored_unknown_company' */
    outcome: text("outcome").notNull().default("applied"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_billing_events_provider_event").on(table.provider, table.providerEventId),
    index("idx_billing_events_company").on(table.companyId, table.createdAt),
  ]
);

export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
