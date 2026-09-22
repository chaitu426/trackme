import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { AppError } from "@trackme/contracts";
import { env } from "@trackme/config";
import { db, users, eq } from "@trackme/db";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
};

export async function getSessionFromCookie(
  cookieValue: string | undefined
): Promise<SessionPayload | null> {
  if (!cookieValue) {
    return null;
  }
  return verifySessionToken(cookieValue, env.NEXTAUTH_SECRET);
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return getSessionFromCookie(jar.get(SESSION_COOKIE)?.value);
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const user = rows[0];
  return user ?? null;
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireApiUser(request: NextRequest): Promise<AuthenticatedUser> {
  const session = await getSessionFromCookie(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const user = rows[0];
  if (!user) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  }
  return user;
}

export async function createSessionCookie(user: { id: string; email: string }): Promise<string> {
  return signSessionToken({ userId: user.id, email: user.email }, env.NEXTAUTH_SECRET);
}

export async function attachSessionCookie(user: { id: string; email: string }): Promise<void> {
  const token = await createSessionCookie(user);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions };
