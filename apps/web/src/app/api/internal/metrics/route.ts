import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { metrics } from "@/lib/metrics-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Prometheus scrape endpoint. Disabled (404) unless METRICS_TOKEN is set, and
 * then requires `Authorization: Bearer <token>`: process and route metrics
 * should not be public.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.METRICS_TOKEN?.trim();
  if (!expected) return new NextResponse(null, { status: 404 });

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !tokenMatches(provided, expected)) {
    return new NextResponse(null, { status: 401 });
  }
  return new NextResponse(await metrics.registry.metrics(), {
    headers: { "Content-Type": metrics.registry.contentType },
  });
}
