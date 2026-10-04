import { pgTable, text, timestamp, uuid, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

/**
 * alert_channels — persistent delivery destinations for automated alerts.
 * A workspace can have many channels of different types.
 */
export const alertChannels = pgTable(
  "alert_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** Human label shown in the UI, e.g. "Team Slack #analytics" */
    name: text("name").notNull(),

    /** Channel delivery type */
    type: text("type").notNull(), // "slack" | "discord" | "email" | "webhook"

    /**
     * Encrypted/opaque config blob per type:
     *   slack:   { webhookUrl }
     *   discord: { webhookUrl }
     *   email:   { addresses: string[] }
     *   webhook: { url, secret }  — HMAC signed with sha256
     */
    config: jsonb("config").notNull().default({}),

    /** Whether this channel is actively used */
    enabled: boolean("enabled").notNull().default(true),

    /** ISO timestamp of the last successful delivery */
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_alert_channels_workspace_id").on(table.workspaceId)]
);

export type AlertChannel = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;
