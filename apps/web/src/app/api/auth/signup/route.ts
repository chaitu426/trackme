import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { hashPassword } from "@/lib/password";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOtp } from "@/lib/otp";

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().email("Please provide a valid email address").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[0-9]|[^a-zA-Z0-9]/, "Password must contain at least one number or special character"),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid registration information.";
      throw new AppError(400, "INVALID_INPUT", msg);
    }

    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    // Rate limit account creation per IP
    await checkRateLimit(
      `signup_ip:${clientIp}`,
      6,
      60 * 60,
      "Too many accounts created from this IP. Please try again later."
    );

    const email = parsed.data.email.toLowerCase();
    const existing = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userId: string;

    if (existing[0]) {
      // If user already exists and verified, reject
      if (existing[0].emailVerified) {
        throw new AppError(409, "EMAIL_IN_USE", "An account with this email address already exists.");
      }
      // If unverified, allow updating password & resending OTP
      const passwordHash = await hashPassword(parsed.data.password);
      await db
        .update(users)
        .set({
          name: parsed.data.name,
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].id));

      userId = existing[0].id;
    } else {
      const passwordHash = await hashPassword(parsed.data.password);
      const created = await db
        .insert(users)
        .values({
          email,
          name: parsed.data.name,
          passwordHash,
          emailVerified: false,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
        });

      const user = created[0];
      if (!user) {
        throw new AppError(500, "SIGNUP_FAILED", "Unable to create account. Please try again.");
      }
      userId = user.id;
    }

    // Always dispatch 6-digit OTP verification code to email
    const code = await createOtp(email, "signup_verify", userId);

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      email,
      message: `A 6-digit verification code has been dispatched to ${email}.`,
      devCode: process.env.NODE_ENV !== "production" ? code : undefined,
    });
  } catch (error) {
    return jsonError(error);
  }
}
