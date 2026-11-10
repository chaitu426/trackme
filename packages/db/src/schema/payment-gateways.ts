import { pgTable, text, timestamp, uuid, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

/**
 * A payment gateway connected to a site. The webhook secret is the gateway's signing secret for this site's endpoint; it is
 * stored encrypted with the same key ring as other secrets (apps/web/src/lib/secret-box.ts) and is never returned to the
 * browser after it is saved.
 */
export const sitePaymentGateways = pgTable(
  "site_payment_gateways",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** razorpay | stripe */
    gateway: text("gateway").notNull(),
    secretEnc: text("secret_enc").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("idx_site_payment_gateways_site_gateway").on(table.siteId, table.gateway)]
);

export type SitePaymentGateway = typeof sitePaymentGateways.$inferSelect;
