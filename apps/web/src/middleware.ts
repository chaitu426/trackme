import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PUBLIC_EXACT = new Set(["/", "/login", "/signup", "/tracker.js", "/demo.html"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }
  // Static assets from /public must stay reachable without a session —
  // the tracker snippet is loaded by third-party sites that are never logged in.
  if (/\.(?:js|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|txt|html)$/i.test(pathname)) {
    return true;
  }
  if (pathname.startsWith("/share/")) {
    return true;
  }
  if (pathname.startsWith("/legal/")) {
    return true;
  }
  if (pathname.startsWith("/invite")) {
    return true;
  }
  if (pathname.startsWith("/api/auth/login") || pathname.startsWith("/api/auth/signup")) {
    return true;
  }
  if (pathname.startsWith("/api/")) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.NEXTAUTH_SECRET;
  const session = token && secret ? await verifySessionToken(token, secret) : null;
  if (session) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
