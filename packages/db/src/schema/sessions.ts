import { pgTable, text, timestamp, uuid, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Server-side session registry.
 * Complements the signed cookie token by allowing server-initiated revocation
 * (logout-all, admin revoke, suspicious activity) without invalidating the
 * secret.  The cookie still carries the HMAC-signed payload for stateless
 * verification; this table is the authoritative revocation / expiry store.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 hash of the raw session token — never store the token itself */
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    /** Whether the session has been explicitly invalidated (logout / revoke) */
    revoked: boolean("revoked").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_sessions_user_id").on(table.userId),
    index("idx_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_expires_at").on(table.expiresAt),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
