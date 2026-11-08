import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { createOtp, enforceOtpSendLimit } from "@/lib/otp";
import { hasPendingSignup } from "@/lib/signup-pending";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

// Only the two flows that exist. (password_reset and email_change have no completion step, so they cannot be requested.)
const SendOtpSchema = z.object({
  email: z.string().trim().email(),
  purpose: z.enum(["login_otp", "signup_verify"]),
});

/**
 * Requests a code. The answer never depends on whether the address is registered:
 *  - login_otp   : passwordless sign-in. Sent only to a verified account that does not require a password first
 *                  (accounts with a second factor must sign in with the password, which issues its own code).
 *  - signup_verify: a resend, honoured only while a sign-up for that address is pending.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = SendOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid email address and purpose are required.");
    }
    const email = parsed.data.email.toLowerCase();
    const { purpose } = parsed.data;

    await checkRateLimit(
      `otp_send_ip:${getClientIp(request)}`,
      10,
      15 * 60,
      "Too many OTP requests from this network. Please wait a few minutes."
    );
    // Before any lookup, so hitting the limit reveals nothing about the address.
    await enforceOtpSendLimit(email, purpose);

    let code: string | undefined;
    if (purpose === "login_otp") {
      const [user] = await db
        .select({ id: users.id, emailVerified: users.emailVerified, totpEnabled: users.totpEnabled })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (user?.emailVerified && !user.totpEnabled) code = await createOtp(email, "login_otp", user.id);
    } else if (await hasPendingSignup(email)) {
      code = await createOtp(email, "signup_verify");
    }

    return NextResponse.json({
      success: true,
      message: "If the address can receive a code, one has been sent.",
      expiresInSeconds: 600,
      ...(code && process.env.NODE_ENV !== "production" ? { devCode: code } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
