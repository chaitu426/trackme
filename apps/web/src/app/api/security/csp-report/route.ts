import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

/**
 * Receives Content-Security-Policy violation reports from browsers (see lib/csp.ts). They are how the policy
 * is moved from report-only to enforcing without guessing. Anyone can post here, so it is rate limited, reads
 * at most 8 KB, always answers 204, and logs only the directive and the origin + path involved: a document URL
 * can carry a token in its query string, which must never reach the logs.
 */
const strip = (value: unknown): string => {
  if (typeof value !== "string") return "-";
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return value.slice(0, 40); // "inline", "eval", "self", ...
  }
};

export async function POST(request: Request) {
  try {
    await checkRateLimit(`csp_report:${getClientIp(request)}`, 60, 60);
    const body = JSON.parse((await request.text()).slice(0, 8192)) as Record<string, Record<string, unknown>>;
    const r = body["csp-report"] ?? {};
    console.warn(
      `[csp] ${String(r["effective-directive"] ?? r["violated-directive"] ?? "-").slice(0, 60)} blocked=${strip(r["blocked-uri"])} page=${strip(r["document-uri"])}`
    );
  } catch {
    // malformed, oversized or rate limited: nothing to do
  }
  return new NextResponse(null, { status: 204 });
}
