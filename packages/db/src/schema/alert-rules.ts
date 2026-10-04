import { pgTable, text, timestamp, uuid, boolean, jsonb, integer, index } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";
import { alertChannels } from "./alert-channels.js";

/**
 * alert_rules — per-site conditions that trigger notifications to one or more channels.
 */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),

    /** Target delivery channel */
    channelId: uuid("channel_id")
      .notNull()
      .references(() => alertChannels.id, { onDelete: "cascade" }),

    /** Rule kind — determines how config is interpreted */
    type: text("type").notNull(),
    // "traffic_spike"    — fire when sessions > X% above rolling average
    // "traffic_drop"     — fire when sessions < X% below baseline
    // "goal_milestone"   — fire when goal conversion count reaches threshold
    // "weekly_digest"    — send summary email every Monday

    /** User-defined rule name, e.g. "Launch Day Traffic Spike" */
    name: text("name").notNull(),

    /**
     * Type-specific config:
     *   traffic_spike/drop: { thresholdPercent: number, windowHours: number }
     *   goal_milestone:     { goalId: string, milestoneCount: number }
     *   weekly_digest:      { timezone: string }
     */
    config: jsonb("config").notNull().default({}),

    /** Whether this rule is actively evaluated */
    enabled: boolean("enabled").notNull().default(true),

    /** Cooldown in minutes between repeated fires of the same rule */
    cooldownMinutes: integer("cooldown_minutes").notNull().default(60),

    /** ISO timestamp of the last time this rule fired */
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_alert_rules_site_id").on(table.siteId),
    index("idx_alert_rules_channel_id").on(table.channelId),
    index("idx_alert_rules_type").on(table.type),
  ]
);

export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
