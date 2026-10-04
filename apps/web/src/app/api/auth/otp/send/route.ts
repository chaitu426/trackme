import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { createOtp, type OtpPurpose } from "@/lib/otp";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

const SendOtpSchema = z.object({
  email: z.string().trim().email(),
  purpose: z.enum(["login_otp", "signup_verify", "password_reset", "email_change"]),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = SendOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "A valid email address and purpose are required.");
    }

    const email = parsed.data.email.toLowerCase();
    const purpose = parsed.data.purpose as OtpPurpose;

    // Rate limit per IP to prevent spamming
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await checkRateLimit(
      `otp_send_ip:${clientIp}`,
      10,
      15 * 60,
      "Too many OTP requests from this network. Please wait a few minutes."
    );

    let userId: string | undefined = undefined;

    // Check user existence if logging in or resetting password
    if (purpose === "login_otp" || purpose === "password_reset") {
      const userRows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!userRows[0]) {
        // Privacy preservation: don't reveal whether user exists
        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, a verification code was sent.",
        });
      }
      userId = userRows[0].id;
    }

    const code = await createOtp(email, purpose, userId);

    // High visibility log in console for development & debugging
    console.log(
      `\n========================================\n` +
      `[SECURITY AUDIT] 6-Digit OTP Generated\n` +
      `Email: ${email}\n` +
      `Purpose: ${purpose}\n` +
      `CODE: [ ${code} ]\n` +
      `Expires in 10 minutes\n` +
      `========================================\n`
    );

    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      success: true,
      message: `A 6-digit verification code has been sent to ${email}.`,
      expiresInSeconds: 600,
      ...(isDev ? { devCode: code } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
