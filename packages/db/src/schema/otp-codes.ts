import { pgTable, text, timestamp, uuid, integer, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Short-lived OTP codes for email verification.
 *
 * Purposes:
 *  - "signup_verify"  – verify email after account creation
 *  - "login_otp"      – passwordless / 2FA step after password login
 *  - "password_reset" – initiate password reset flow
 *  - "email_change"   – confirm new email address
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * userId is nullable: during signup flow the user may not exist yet.
     * Once the email is verified we link it to the created user.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** The email address the OTP was sent to */
    email: text("email").notNull(),
    /** HMAC-SHA256 of the 6-digit code — never store the raw OTP */
    codeHash: text("code_hash").notNull(),
    /** "signup_verify" | "login_otp" | "password_reset" | "email_change" */
    purpose: text("purpose").notNull(),
    /** Number of failed verification attempts (lock after 5) */
    attempts: integer("attempts").notNull().default(0),
    used: boolean("used").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_otp_codes_email_purpose").on(table.email, table.purpose),
    index("idx_otp_codes_expires_at").on(table.expiresAt),
  ]
);

export type OtpCode = typeof otpCodes.$inferSelect;
export type NewOtpCode = typeof otpCodes.$inferInsert;
