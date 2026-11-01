import { NextRequest, NextResponse } from "next/server";
import { MetricQueryRequestSchema } from "@trackme/contracts";
import { getBreakdown, type BreakdownDimension } from "@trackme/analytics";
import { requireMetricsAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";
import { cached, cacheKey, normalizeRequest, ttlSecondsFor } from "@/lib/query-cache";

const DIMENSIONS = new Set<BreakdownDimension>([
  "path",
  "referrer",
  "channel",
  "campaign_source",
  "campaign_medium",
  "campaign_name",
  "country",
  "city",
  "browser",
  "os",
  "device",
]);

async function handlePost(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawDimension = searchParams.get("dimension") ?? "path";
    if (!DIMENSIONS.has(rawDimension as BreakdownDimension)) {
      return NextResponse.json({ error: "Invalid breakdown dimension" }, { status: 400 });
    }
    const dimension = rawDimension as BreakdownDimension;

    const body: unknown = await request.json();
    const parsed = MetricQueryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query payload", details: parsed.error.errors },
        { status: 400 }
      );
    }

    await requireMetricsAccess(request, parsed.data.workspaceId, parsed.data.siteId);
    const query = normalizeRequest(parsed.data);
    const breakdown = await cached(
      cacheKey("breakdown", query, `${dimension}:v2`),
      ttlSecondsFor(Date.parse(query.dateRange.to)),
      () => getBreakdown(query, dimension)
    );
    return NextResponse.json(breakdown);
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = timedRoute("breakdown", handlePost);
