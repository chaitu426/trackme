import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteFunnels, sites, eq, and } from "@trackme/db";
import { cachedFunnel } from "@/lib/query-cache";
import { analyzeFunnel, type FunnelStepDefinition } from "@trackme/analytics";
import { authenticateSite } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

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

    await authenticateSite(request, siteRow.workspaceId, siteId, "analytics:read", "funnels");

    const [funnel] = await db
      .select()
      .from(siteFunnels)
      .where(and(eq(siteFunnels.id, funnelId), eq(siteFunnels.siteId, siteId)))
      .limit(1);

    if (!funnel) {
      throw new AppError(404, "FUNNEL_NOT_FOUND", "Funnel not found.");
    }

    // Parse date range from query params (default to last 30 days)
    const now = new Date();
    const days = Math.min(31, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("days") ?? "30", 10) || 30));
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const from = request.nextUrl.searchParams.get("from") || windowStart.toISOString();
    const to = request.nextUrl.searchParams.get("to") || now.toISOString();

    const steps = (funnel.steps as unknown as FunnelStepDefinition[]) || [];
    const analysis = await cachedFunnel(
      {
        workspaceId: siteRow.workspaceId,
        siteId,
        dateRange: { from, to, granularity: "day" },
      },
      steps,
      86400,
      (normalized) => analyzeFunnel(normalized, steps)
    );

    return NextResponse.json({
      funnel,
      analysis,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
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

    await authenticateSite(request, siteRow.workspaceId, siteId, "sites:update", "funnels");

    const deleted = await db
      .delete(siteFunnels)
      .where(and(eq(siteFunnels.id, funnelId), eq(siteFunnels.siteId, siteId)))
      .returning({ id: siteFunnels.id });

    if (!deleted[0]) {
      throw new AppError(404, "FUNNEL_NOT_FOUND", "Funnel not found.");
    }

    return NextResponse.json({ success: true, deletedId: funnelId });
  } catch (error) {
    return jsonError(error);
  }
}

export const GET = timedRoute("funnel", handleGet);
