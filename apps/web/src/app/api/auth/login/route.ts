import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { verifyPassword } from "@/lib/password";
import { attachSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listUserWorkspaces } from "@/lib/tenancy";
import {
  checkRateLimit,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
} from "@/lib/rate-limit";
import { createOtp } from "@/lib/otp";

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional().default(false),
  requireOtp: z.boolean().optional().default(false),
});

const INVALID_CREDENTIALS = new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      throw INVALID_CREDENTIALS;
    }

    const email = parsed.data.email.toLowerCase();
    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = request.headers.get("user-agent") || undefined;

    // 1. IP-level rate limit (protect against distributed dictionary attacks)
    await checkRateLimit(
      `login_ip:${clientIp}`,
      20,
      15 * 60,
      "Too many login attempts from this network. Please try again in 15 minutes."
    );

    // 2. Account-level brute-force lockout
    const failureStatus = await recordFailedLoginAttempt(email, 5, 15 * 60);
    if (failureStatus.isLocked) {
      throw new AppError(
        423,
        "ACCOUNT_LOCKED",
        "Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes or reset your password."
      );
    }

    // 3. User lookup
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        totpEnabled: users.totpEnabled,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = rows[0];
    if (!user || !user.passwordHash) {
      throw INVALID_CREDENTIALS;
    }

    // 4. Verify password
    const matches = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!matches) {
      const remaining = failureStatus.remainingAttempts;
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        remaining > 0
          ? `Invalid email or password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
          : "Invalid email or password."
      );
    }

    // Password is valid - reset failed attempts tracker
    await clearFailedLoginAttempts(email);

    // 5. 2FA / OTP check: If user requested OTP or has 2FA enabled
    if (user.totpEnabled || parsed.data.requireOtp) {
      const code = await createOtp(email, "login_otp", user.id);
      console.log(`[AUTH 2FA] Login OTP generated for ${email}: [ ${code} ]`);

      return NextResponse.json({
        requiresOtp: true,
        email,
        message: "A 6-digit security code has been sent to your email.",
        devCode: process.env.NODE_ENV !== "production" ? code : undefined,
      });
    }

    // 6. Direct session creation
    await attachSessionCookie(
      { id: user.id, email: user.email },
      {
        rememberMe: parsed.data.rememberMe,
        userAgent,
        ipAddress: clientIp,
      }
    );

    const memberships = await listUserWorkspaces(user.id);
    const firstWorkspace = memberships[0];

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
      redirectTo: firstWorkspace ? `/${firstWorkspace.slug}/overview` : "/onboarding",
    });
  } catch (error) {
    return jsonError(error);
  }
}
