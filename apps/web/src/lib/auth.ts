import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, users, eq } from "@trackme/db";
import {
  SESSION_SHORT_TTL_SECONDS,
  SESSION_REMEMBER_TTL_SECONDS,
  createRegisteredSession,
  validateRegisteredSession,
  revokeRegisteredSession,
  sessionCookieOptions,
} from "./session-store";
import { SESSION_COOKIE, type SessionPayload } from "./session";

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
  return validateRegisteredSession(cookieValue);
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
  const cookieVal = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSessionFromCookie(cookieVal);
  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required or session has expired");
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
    throw new AppError(401, "UNAUTHENTICATED", "User not found or account removed");
  }
  return user;
}

export async function attachSessionCookie(
  user: { id: string; email: string },
  options?: {
    rememberMe?: boolean | undefined;
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
  }
): Promise<string> {
  const { token, maxAgeSeconds } = await createRegisteredSession({
    userId: user.id,
    email: user.email,
    rememberMe: options?.rememberMe,
    userAgent: options?.userAgent,
    ipAddress: options?.ipAddress,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(maxAgeSeconds));
  return token;
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeRegisteredSession(token);
  }
  jar.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

export {
  SESSION_COOKIE,
  SESSION_SHORT_TTL_SECONDS,
  SESSION_REMEMBER_TTL_SECONDS,
  sessionCookieOptions,
};
