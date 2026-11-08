import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { attachSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listUserWorkspaces } from "@/lib/tenancy";
import {
  checkRateLimit,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
} from "@/lib/rate-limit";
import { createOtp, enforceOtpSendLimit } from "@/lib/otp";
import { createLoginChallenge } from "@/lib/login-challenge";
import { getClientIp } from "@/lib/client-ip";

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional().default(false),
  requireOtp: z.boolean().optional().default(false),
});

// One message for every way a sign-in can fail (no such account, wrong password, unverified account), so the
// response never reveals which addresses are registered.
const INVALID_CREDENTIALS = new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      throw INVALID_CREDENTIALS;
    }

    const email = parsed.data.email.toLowerCase();
    const clientIp = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || undefined;

    // 1. Address-level limit (protects against distributed dictionary attacks)
    await checkRateLimit(
      `login_ip:${clientIp}`,
      20,
      15 * 60,
      "Too many login attempts from this network. Please try again in 15 minutes."
    );

    // 2. Failure counters, recorded before the lookup so they apply identically to every address. They are
    // keyed by (email, caller address): a stranger elsewhere cannot lock a real user out. A much higher
    // per-email ceiling still stops a guesser spread over many addresses.
    const pair = await recordFailedLoginAttempt(`${email}|${clientIp}`, 5, 15 * 60);
    const overall = await recordFailedLoginAttempt(`email:${email}`, 40, 15 * 60);
    if (pair.isLocked || overall.isLocked) {
      throw new AppError(423, "ACCOUNT_LOCKED", "Too many attempts. Please try again in 15 minutes.");
    }

    // 3. User lookup
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
        totpEnabled: users.totpEnabled,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = rows[0];
    // An unverified address cannot sign in: it was never proven to belong to the person who registered it.
    if (!user || !user.passwordHash || !user.emailVerified) {
      await burnPasswordCheck(parsed.data.password);
      throw INVALID_CREDENTIALS;
    }

    // 4. Verify password
    const matches = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!matches) {
      throw INVALID_CREDENTIALS;
    }

    // Move older hashes to the current cost now that the plaintext is in hand. Best effort: a failure here must
    // not stop a correct sign-in.
    if (needsRehash(user.passwordHash)) {
      try {
        await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, user.id));
      } catch (err) {
        console.warn("[Login] password hash upgrade failed:", err);
      }
    }

    // Password is valid: reset the failure counters
    await clearFailedLoginAttempts(`${email}|${clientIp}`);
    await clearFailedLoginAttempts(`email:${email}`);

    // 5. Second factor. The emailed code is accepted only together with the challenge issued here, so it
    // cannot be used on its own to sign in to this account.
    if (user.totpEnabled || parsed.data.requireOtp) {
      await enforceOtpSendLimit(email, "login_otp");
      const code = await createOtp(email, "login_otp", user.id);
      const challenge = await createLoginChallenge(user.id);

      return NextResponse.json({
        requiresOtp: true,
        email,
        challenge,
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
