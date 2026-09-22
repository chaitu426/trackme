import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import { verifyPassword } from "@/lib/password";
import { attachSessionCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listUserWorkspaces } from "@/lib/tenancy";

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
});

const INVALID_CREDENTIALS = new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

export async function POST(request: Request) {
  try {
    const parsed = LoginSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw INVALID_CREDENTIALS;
    }

    const email = parsed.data.email.toLowerCase();
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = rows[0];
    if (!user || !user.passwordHash) {
      throw INVALID_CREDENTIALS;
    }

    const matches = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!matches) {
      throw INVALID_CREDENTIALS;
    }

    await attachSessionCookie({ id: user.id, email: user.email });
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
