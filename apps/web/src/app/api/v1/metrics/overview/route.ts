import { NextRequest, NextResponse } from "next/server";
import { MetricQueryRequestSchema } from "@trackme/contracts";
import { getOverviewMetrics } from "@trackme/analytics";
import { requireMetricsAccess } from "@/lib/tenancy";
import { getActiveVisitorCount } from "@/lib/realtime";
import { jsonError } from "@/lib/http";

export async function POST(request: NextRequest) {
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
    const [metrics, activeVisitorsNow] = await Promise.all([
      getOverviewMetrics(parsed.data),
      getActiveVisitorCount(parsed.data.siteId),
    ]);
    return NextResponse.json({ ...metrics, activeVisitorsNow });
  } catch (error) {
    return jsonError(error);
  }
}
