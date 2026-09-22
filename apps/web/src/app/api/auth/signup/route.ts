import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { hashPassword } from "@/lib/password";
import { attachSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listUserWorkspaces } from "@/lib/tenancy";

const SignupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const parsed = SignupSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "Name, email, and a password of at least 8 characters are required");
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const created = await db
      .insert(users)
      .values({
        email,
        name: parsed.data.name,
        passwordHash,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
      });

    const user = created[0];
    if (!user) {
      throw new AppError(500, "SIGNUP_FAILED", "Unable to create account");
    }

    await attachSessionCookie(user);
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
