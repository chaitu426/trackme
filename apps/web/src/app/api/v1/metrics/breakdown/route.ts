import { NextRequest, NextResponse } from "next/server";
import { MetricQueryRequestSchema } from "@trackme/contracts";
import { getBreakdown, type BreakdownDimension } from "@trackme/analytics";
import { requireMetricsAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

const DIMENSIONS = new Set<BreakdownDimension>([
  "path",
  "referrer",
  "campaign_source",
  "campaign_medium",
  "campaign_name",
  "country",
  "browser",
  "os",
  "device",
]);

export async function POST(request: NextRequest) {
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
    const breakdown = await getBreakdown(parsed.data, dimension);
    return NextResponse.json(breakdown);
  } catch (error) {
    return jsonError(error);
  }
}
