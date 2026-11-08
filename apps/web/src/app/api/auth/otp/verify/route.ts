import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { verifyOtp } from "@/lib/otp";
import { attachSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listUserWorkspaces } from "@/lib/tenancy";
import { checkRateLimit, clearFailedLoginAttempts } from "@/lib/rate-limit";
import { challengeMatches, consumeLoginChallenge } from "@/lib/login-challenge";
import { takePendingSignup } from "@/lib/signup-pending";
import { getClientIp } from "@/lib/client-ip";

const VerifyOtpSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().length(6, "Code must be exactly 6 digits"),
  purpose: z.enum(["login_otp", "signup_verify"]),
  rememberMe: z.boolean().optional().default(false),
  /** Issued by /auth/login after a correct password; required to complete sign-in for protected accounts. */
  challenge: z.string().max(100).optional(),
});

// The same answer for every kind of "this cannot succeed", so the response does not say why.
const REJECTED = () => new AppError(400, "OTP_INVALID", "Verification code is invalid or has expired.");

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid verification input.";
      throw new AppError(400, "INVALID_INPUT", msg);
    }

    const email = parsed.data.email.toLowerCase();
    const { code, purpose, rememberMe, challenge } = parsed.data;
    const clientIp = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || undefined;

    // Rate limit brute-force verification attempts
    await checkRateLimit(
      `otp_verify_ip:${clientIp}:${email}`,
      10,
      10 * 60,
      "Too many failed verification attempts. Please request a new code."
    );

    const [existing] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
        totpEnabled: users.totpEnabled,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (purpose === "login_otp") {
      // An unverified or unknown address cannot sign in this way, and an account that requires its password
      // must present the challenge that the password step issued. Checked BEFORE the code is spent.
      if (!existing || !existing.emailVerified) throw REJECTED();
      if (existing.totpEnabled && !(await challengeMatches(challenge, existing.id))) throw REJECTED();
    }

    await verifyOtp(email, code, purpose);
    await clearFailedLoginAttempts(`email:${email}`);

    if (purpose === "login_otp" && existing) {
      if (challenge) await consumeLoginChallenge(challenge);
      await attachSessionCookie(
        { id: existing.id, email: existing.email },
        { rememberMe, userAgent, ipAddress: clientIp }
      );
      const memberships = await listUserWorkspaces(existing.id);
      const first = memberships[0];
      return NextResponse.json({
        success: true,
        user: { id: existing.id, email: existing.email, name: existing.name },
        redirectTo: first ? `/${first.slug}/overview` : "/onboarding",
      });
    }

    // signup_verify: the account is created now, from the credentials stored when the sign-up started.
    const pending = await takePendingSignup(email);
    if (!pending) {
      throw new AppError(400, "SIGNUP_EXPIRED", "This sign-up has expired. Please start again.");
    }

    let user: { id: string; email: string; name: string };
    if (existing?.emailVerified) {
      throw REJECTED(); // the address was registered in the meantime; its owner uses the sign-in page
    } else if (existing) {
      // A leftover unverified row from before accounts were created only on verification: adopt it.
      const [updated] = await db
        .update(users)
        .set({ name: pending.name, passwordHash: pending.passwordHash, emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning({ id: users.id, email: users.email, name: users.name });
      if (!updated) throw REJECTED();
      user = updated;
    } else {
      const [created] = await db
        .insert(users)
        .values({ email, name: pending.name, passwordHash: pending.passwordHash, emailVerified: true })
        .returning({ id: users.id, email: users.email, name: users.name });
      if (!created) throw new AppError(500, "SIGNUP_FAILED", "Unable to create account. Please try again.");
      user = created;
    }

    await attachSessionCookie({ id: user.id, email: user.email }, { rememberMe, userAgent, ipAddress: clientIp });
    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      redirectTo: "/onboarding",
    });
  } catch (error) {
    return jsonError(error);
  }
}
