import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  validateRegisteredSession,
  revokeRegisteredSession,
  createRegisteredSession,
  sessionCookieOptions,
} from "@/lib/session-store";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ authenticated: false });
    }

    const session = await validateRegisteredSession(token);
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      user,
      expiresAt: new Date(session.exp * 1000).toISOString(),
      remainingSeconds: session.remainingSeconds,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const session = await validateRegisteredSession(token);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = request.headers.get("user-agent") || undefined;

    // Revoke old session and issue fresh extended session
    await revokeRegisteredSession(token);

    const { token: newToken, expiresAt, maxAgeSeconds } = await createRegisteredSession({
      userId: session.userId,
      email: session.email,
      rememberMe: session.remainingSeconds > 86400, // Preserve extended duration if already remembered
      userAgent,
      ipAddress: clientIp,
    });

    jar.set(SESSION_COOKIE, newToken, sessionCookieOptions(maxAgeSeconds));

    return NextResponse.json({
      success: true,
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: maxAgeSeconds,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE() {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token) {
      await revokeRegisteredSession(token);
    }
    jar.set(SESSION_COOKIE, "", sessionCookieOptions(0));

    return NextResponse.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    return jsonError(error);
  }
}
