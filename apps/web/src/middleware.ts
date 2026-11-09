import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { cspHeader, cspMode, newNonce } from "@/lib/csp";

const PUBLIC_EXACT = new Set(["/", "/login", "/signup", "/tracker.js", "/demo.html"]);
const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/session",
  // Called before a session exists: the code itself is the credential, and verify issues the session.
  "/api/auth/otp",
  "/api/v1/invites/accept",
  // A CI job reports a deploy with an API key (Authorization: Bearer); the route checks the key itself.
  "/api/v1/deploys",
  // Browsers post CSP violation reports without credentials.
  "/api/security/csp-report",
  // Authenticates itself with METRICS_TOKEN (404 when unset); Prometheus has no session.
  "/api/internal/metrics",
];

export function isPublicPath(pathname: string): boolean {
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
  if (pathname.startsWith("/api/")) {
    return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  }
  return false;
}

/** No API route takes more than a form-sized JSON body. Rejecting larger ones before any parsing bounds the memory a request can make validation use. */
export const MAX_API_BODY_BYTES = 1_000_000;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") && Number(request.headers.get("content-length") ?? 0) > MAX_API_BODY_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", message: "Request body is too large." }, { status: 413 });
  }

  // A fresh nonce per request. Next reads it from the request's Content-Security-Policy header and puts it on
  // its own scripts; the response carries the policy (report-only unless CSP_MODE=enforce, see lib/csp.ts).
  const mode = process.env.NODE_ENV === "production" ? cspMode(process.env.CSP_MODE) : "off";
  const nonce = newNonce();
  const header = cspHeader(mode, nonce);
  const pass = (): NextResponse => {
    if (!header) return NextResponse.next();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("content-security-policy", header.value);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set(header.name, header.value);
    return response;
  };

  if (isPublicPath(pathname)) {
    return pass();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.NEXTAUTH_SECRET;
  const session = token && secret ? await verifySessionToken(token, secret) : null;
  if (session) {
    return pass();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "UNAUTHENTICATED", message: "Authentication is required." }, { status: 401 });
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
