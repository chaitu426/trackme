import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteFunnels, sites, eq, and } from "@trackme/db";
import {
  analyzeFunnelInsights,
  FUNNEL_SEGMENTS,
  type FunnelSegment,
  type FunnelStepDefinition,
} from "@trackme/analytics";
import { cachedFunnelKind } from "@/lib/query-cache";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

function isSegment(value: string | null): value is FunnelSegment {
  return value !== null && Object.prototype.hasOwnProperty.call(FUNNEL_SEGMENTS, value);
}

async function handleGet(
  request: NextRequest,
  props: { params: Promise<{ siteId: string; funnelId: string }> }
) {
  try {
    const { siteId, funnelId } = await props.params;

    const [siteRow] = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (!siteRow) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
    }

    await authenticateRequest(request, siteRow.workspaceId, "read:analytics");

    const [funnel] = await db
      .select()
      .from(siteFunnels)
      .where(and(eq(siteFunnels.id, funnelId), eq(siteFunnels.siteId, siteId)))
      .limit(1);
    if (!funnel) {
      throw new AppError(404, "FUNNEL_NOT_FOUND", "Funnel not found.");
    }

    const segmentParam = request.nextUrl.searchParams.get("segment");
    const segment: FunnelSegment = isSegment(segmentParam) ? segmentParam : "device";

    const now = new Date();
    const days = Math.min(31, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10) || 30));
    const from = request.nextUrl.searchParams.get("from") || new Date(now.getTime() - days * 86_400_000).toISOString();
    const to = request.nextUrl.searchParams.get("to") || now.toISOString();
    const steps = (funnel.steps as unknown as FunnelStepDefinition[]) || [];

    const insights = await cachedFunnelKind(
      `funnelx:${segment}`,
      { workspaceId: siteRow.workspaceId, siteId, dateRange: { from, to, granularity: "day" as const } },
      steps,
      86400,
      (normalized) => analyzeFunnelInsights(normalized, steps, segment)
    );

    return NextResponse.json({ segment, ...insights });
  } catch (error) {
    return jsonError(error);
  }
}

export const GET = timedRoute("funnel_insights", handleGet);
