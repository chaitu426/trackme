/**
 * Email OTP Library
 *
 * Generates, stores, and verifies 6-digit one-time passwords for:
 *   - signup_verify  : email address confirmation after account creation
 *   - login_otp      : 2FA / passwordless second factor
 *   - password_reset : initiate password reset
 *   - email_change   : confirm new email address
 *
 * Security properties:
 *   - Raw OTP is NEVER stored — only HMAC-SHA256(otp, NEXTAUTH_SECRET)
 *   - 6 digit numeric OTP → 1 in 1,000,000 per attempt
 *   - Max 5 failed attempts → OTP invalidated (prevents brute-force)
 *   - 10-minute expiry by default
 *   - Redis rate-limit: max 3 sends per email per 15 minutes
 *   - Constant-time comparison for HMAC verification
 */

import { createHmac, randomInt, timingSafeEqual, createHash } from "node:crypto";
import { env } from "@trackme/config";
import {
  db,
  otpCodes,
  and,
  eq,
  gt,
} from "@trackme/db";
import { AppError } from "@trackme/contracts";
import { getRedis } from "./redis";
import { sendOtpEmail } from "./email";

export type OtpPurpose = "signup_verify" | "login_otp" | "password_reset" | "email_change";

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_SEND_RATE_LIMIT = 3; // max sends per window
const OTP_SEND_WINDOW_SECONDS = 15 * 60; // per 15 minutes

function hashOtp(code: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update(code).digest("hex");
}

function generateOtpCode(): string {
  // Cryptographically secure 6-digit OTP, zero-padded
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Check send rate limit via Redis.
 * Throws if the email has already been sent too many OTPs in the window.
 */
async function checkSendRateLimit(email: string, purpose: OtpPurpose): Promise<void> {
  const redis = getRedis();
  const key = `otp_send_limit:${purpose}:${email}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, OTP_SEND_WINDOW_SECONDS);
  }
  if (count > OTP_SEND_RATE_LIMIT) {
    throw new AppError(
      429,
      "OTP_RATE_LIMITED",
      `Too many verification codes sent. Please wait before requesting another.`
    );
  }
}

/**
 * Creates a new OTP for the given email and purpose.
 * Invalidates all previous unexpired OTPs for the same email + purpose.
 * Returns the plaintext OTP (to be emailed — never log this).
 */
export async function createOtp(
  email: string,
  purpose: OtpPurpose,
  userId?: string
): Promise<string> {
  await checkSendRateLimit(email, purpose);

  // Invalidate any existing unexpired OTPs for this email + purpose
  await db
    .update(otpCodes)
    .set({ used: true })
    .where(
      and(
        eq(otpCodes.email, email),
        eq(otpCodes.purpose, purpose),
        eq(otpCodes.used, false)
      )
    );

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await db.insert(otpCodes).values({
    email: email.toLowerCase(),
    codeHash,
    purpose,
    userId: userId ?? null,
    expiresAt,
  });

  // Dispatch email via Resend or dev console
  await sendOtpEmail(email, code, purpose);

  return code;
}

/**
 * Verifies an OTP submitted by the user.
 * On success: marks OTP as used and returns the matched record.
 * On failure: increments attempt counter. Invalidates after OTP_MAX_ATTEMPTS.
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose
): Promise<{ userId: string | null }> {
  const now = new Date();
  const rows = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.email, email.toLowerCase()),
        eq(otpCodes.purpose, purpose),
        eq(otpCodes.used, false),
        gt(otpCodes.expiresAt, now)
      )
    )
    .limit(1);

  const record = rows[0];

  if (!record) {
    throw new AppError(400, "OTP_INVALID", "Verification code is invalid or has expired.");
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    // Invalidate the OTP immediately
    await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, record.id));
    throw new AppError(400, "OTP_LOCKED", "Too many incorrect attempts. Please request a new code.");
  }

  // Constant-time comparison
  const expectedHash = Buffer.from(hashOtp(code), "hex");
  const actualHash = Buffer.from(record.codeHash, "hex");
  const match =
    expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);

  if (!match) {
    await db
      .update(otpCodes)
      .set({ attempts: record.attempts + 1 })
      .where(eq(otpCodes.id, record.id));
    const remaining = OTP_MAX_ATTEMPTS - record.attempts - 1;
    throw new AppError(
      400,
      "OTP_WRONG",
      remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many incorrect attempts. Please request a new code."
    );
  }

  // Mark as used
  await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, record.id));

  return { userId: record.userId };
}

/**
 * Hash the session token for server-side storage.
 * Uses SHA-256 (not HMAC) — the token itself already has entropy.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
