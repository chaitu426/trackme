import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { verifyOtp, type OtpPurpose } from "@/lib/otp";
import { attachSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listUserWorkspaces } from "@/lib/tenancy";
import { checkRateLimit, clearFailedLoginAttempts } from "@/lib/rate-limit";

const VerifyOtpSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().length(6, "Code must be exactly 6 digits"),
  purpose: z.enum(["login_otp", "signup_verify", "password_reset", "email_change"]),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid verification input.";
      throw new AppError(400, "INVALID_INPUT", msg);
    }

    const email = parsed.data.email.toLowerCase();
    const { code, purpose, rememberMe } = parsed.data;

    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = request.headers.get("user-agent") || undefined;

    // Rate limit brute-force verification attempts
    await checkRateLimit(
      `otp_verify_ip:${clientIp}:${email}`,
      10,
      10 * 60,
      "Too many failed verification attempts. Please request a new code."
    );

    // Verify OTP using constant-time comparison & attempts counter
    await verifyOtp(email, code, purpose as OtpPurpose);

    // Clear any lockout trackers on success
    await clearFailedLoginAttempts(email);

    if (purpose === "login_otp" || purpose === "signup_verify") {
      const userRows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      const user = userRows[0];
      if (!user) {
        throw new AppError(404, "USER_NOT_FOUND", "Account not found.");
      }

      // Mark email as verified if verifying signup
      if (purpose === "signup_verify" && !user.emailVerified) {
        await db
          .update(users)
          .set({ emailVerified: true, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      }

      // Issue registered session token
      await attachSessionCookie(
        { id: user.id, email: user.email },
        { rememberMe, userAgent, ipAddress: clientIp }
      );

      const memberships = await listUserWorkspaces(user.id);
      const firstWorkspace = memberships[0];
      const redirectTo = firstWorkspace ? `/${firstWorkspace.slug}/overview` : "/onboarding";

      return NextResponse.json({
        success: true,
        user: { id: user.id, email: user.email, name: user.name },
        redirectTo,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Verification successful.",
    });
  } catch (error) {
    return jsonError(error);
  }
}
