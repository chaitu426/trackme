import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { hashPassword } from "@/lib/password";
import { assertAcceptablePassword } from "@/lib/password-policy";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOtp, enforceOtpSendLimit } from "@/lib/otp";
import { savePendingSignup } from "@/lib/signup-pending";
import { sendAccountExistsEmail } from "@/lib/email";
import { getClientIp } from "@/lib/client-ip";

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().email("Please provide a valid email address").max(255),
  // The strength rules (length, common and breached passwords) live in lib/password-policy.
  password: z.string().min(1, "Choose a password").max(128, "Use at most 128 characters."),
});

/**
 * Sign-up does not create an account. It stores the chosen credentials for 15 minutes and emails a code; the
 * account exists only once the mailbox owner enters it (api/auth/otp/verify). So nobody can register an
 * address they do not control, and a repeat sign-up for the same address just replaces the pending one.
 *
 * The response is identical whether or not the address already has an account (an account that exists gets an
 * "you already have an account" email instead of a code), and the same work is done in both cases, so neither
 * the response nor its timing reveals who is registered.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid registration information.";
      throw new AppError(400, "INVALID_INPUT", msg);
    }
    const email = parsed.data.email.toLowerCase();

    await checkRateLimit(
      `signup_ip:${getClientIp(request)}`,
      6,
      60 * 60,
      "Too many accounts created from this IP. Please try again later."
    );
    await enforceOtpSendLimit(email, "signup_verify");
    await assertAcceptablePassword(parsed.data.password, { email, name: parsed.data.name });

    // Hash first, for every address, so the work done does not depend on whether the account exists.
    const passwordHash = await hashPassword(parsed.data.password);

    const [existing] = await db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let devCode: string | undefined;
    if (existing?.emailVerified) {
      await sendAccountExistsEmail(email).catch((err) => console.error("[Signup] notice email failed:", err));
    } else {
      await savePendingSignup(email, { name: parsed.data.name, passwordHash });
      const code = await createOtp(email, "signup_verify");
      if (process.env.NODE_ENV !== "production") devCode = code;
    }

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      email,
      message: `If this address can receive mail, a 6-digit verification code has been sent to ${email}.`,
      devCode,
    });
  } catch (error) {
    return jsonError(error);
  }
}
