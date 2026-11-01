import { NextRequest, NextResponse } from "next/server";
import { MetricQueryRequestSchema } from "@trackme/contracts";
import { getOverviewMetrics } from "@trackme/analytics";
import { requireMetricsAccess } from "@/lib/tenancy";
import { getActiveVisitorCount } from "@/lib/realtime";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";
import { cached, cacheKey, normalizeRequest, ttlSecondsFor } from "@/lib/query-cache";

async function handlePost(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const parsed = MetricQueryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query payload", details: parsed.error.errors },
        { status: 400 }
      );
    }

    await requireMetricsAccess(request, parsed.data.workspaceId, parsed.data.siteId);
    // Authorized above, so a cache hit never skips access control. The live
    // visitor count is cheap and must stay fresh, so it is not cached.
    const query = normalizeRequest(parsed.data);
    const [metrics, activeVisitorsNow] = await Promise.all([
      cached(cacheKey("overview", query, "v2"), ttlSecondsFor(Date.parse(query.dateRange.to)), () =>
        getOverviewMetrics(query)
      ),
      getActiveVisitorCount(parsed.data.siteId),
    ]);
    return NextResponse.json({ ...metrics, dateRange: parsed.data.dateRange, activeVisitorsNow });
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = timedRoute("overview", handlePost);
