/**
 * Email OTP Library
 *
 * Generates, stores, and verifies 6-digit one-time passwords for:
 *   - signup_verify  : email address confirmation; the account is created only when this succeeds
 *   - login_otp      : passwordless sign-in, or the second step after a correct password (needs a login challenge)
 *   - password_reset : reserved
 *   - email_change   : reserved
 *
 * Security properties:
 *   - Raw OTP is NEVER stored: only HMAC-SHA256(otp, NEXTAUTH_SECRET)
 *   - 6 digit numeric OTP = 1 in 1,000,000 per attempt
 *   - At most OTP_MAX_ATTEMPTS guesses per code, enforced by an atomic database update that spends the attempt
 *     BEFORE the code is compared. Counting after the comparison let parallel requests all read "0 attempts"
 *     and make far more than five guesses.
 *   - A code can be consumed exactly once (the final update is conditional on it being unused)
 *   - 10-minute expiry; sends are limited per address by enforceOtpSendLimit
 *   - Constant-time comparison
 */

import { createHmac, randomInt, timingSafeEqual, createHash } from "node:crypto";
import { env } from "@trackme/config";
import { db, otpCodes, and, eq, gt, lt, sql } from "@trackme/db";
import { AppError } from "@trackme/contracts";
import { checkRateLimit } from "./rate-limit";
import { sendOtpEmail } from "./email";

export type OtpPurpose = "signup_verify" | "login_otp" | "password_reset" | "email_change";

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
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
 * Limits how often codes can be requested for one address. Call it at the top of every route that can send
 * a code, BEFORE looking the address up: if the limit only applied to addresses that have an account, hitting
 * it would reveal which addresses do.
 */
export async function enforceOtpSendLimit(email: string, purpose: OtpPurpose): Promise<void> {
  await checkRateLimit(
    `otp_send:${purpose}:${email.toLowerCase()}`,
    OTP_SEND_RATE_LIMIT,
    OTP_SEND_WINDOW_SECONDS,
    "Too many verification codes requested. Please wait before requesting another."
  );
}

/**
 * Creates a new OTP for the given email and purpose and emails it. Invalidates all previous unexpired OTPs for
 * the same email + purpose. Returns the plaintext OTP (never log it). Callers must have called
 * enforceOtpSendLimit first.
 */
export async function createOtp(email: string, purpose: OtpPurpose, userId?: string): Promise<string> {
  await db
    .update(otpCodes)
    .set({ used: true })
    .where(and(eq(otpCodes.email, email.toLowerCase()), eq(otpCodes.purpose, purpose), eq(otpCodes.used, false)));

  const code = generateOtpCode();
  await db.insert(otpCodes).values({
    email: email.toLowerCase(),
    codeHash: hashOtp(code),
    purpose,
    userId: userId ?? null,
    expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
  });

  await sendOtpEmail(email, code, purpose);
  return code;
}

/**
 * Verifies an OTP submitted by the user. On success the code is consumed and the matched record's user is
 * returned. A wrong guess spends one of the code's OTP_MAX_ATTEMPTS attempts.
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose
): Promise<{ userId: string | null }> {
  const rows = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.email, email.toLowerCase()),
        eq(otpCodes.purpose, purpose),
        eq(otpCodes.used, false),
        gt(otpCodes.expiresAt, new Date())
      )
    )
    .limit(1);

  const record = rows[0];
  if (!record) {
    throw new AppError(400, "OTP_INVALID", "Verification code is invalid or has expired.");
  }

  // Spend an attempt first, atomically. Only requests that win a slot under the limit get to compare.
  const [spent] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, record.id), eq(otpCodes.used, false), lt(otpCodes.attempts, OTP_MAX_ATTEMPTS)))
    .returning({ attempts: otpCodes.attempts });

  if (!spent) {
    await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, record.id));
    throw new AppError(400, "OTP_LOCKED", "Too many incorrect attempts. Please request a new code.");
  }

  const expectedHash = Buffer.from(hashOtp(code), "hex");
  const actualHash = Buffer.from(record.codeHash, "hex");
  const match = expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);

  if (!match) {
    const remaining = OTP_MAX_ATTEMPTS - spent.attempts;
    if (remaining <= 0) {
      await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, record.id));
    }
    throw new AppError(
      400,
      "OTP_WRONG",
      remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many incorrect attempts. Please request a new code."
    );
  }

  // Consume exactly once: if two requests present the right code together, only one gets the row back.
  const [consumed] = await db
    .update(otpCodes)
    .set({ used: true })
    .where(and(eq(otpCodes.id, record.id), eq(otpCodes.used, false)))
    .returning({ id: otpCodes.id });
  if (!consumed) {
    throw new AppError(400, "OTP_INVALID", "Verification code is invalid or has expired.");
  }

  return { userId: record.userId };
}

/**
 * Hash the session token for server-side storage.
 * Uses SHA-256 (not HMAC) — the token itself already has entropy.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
