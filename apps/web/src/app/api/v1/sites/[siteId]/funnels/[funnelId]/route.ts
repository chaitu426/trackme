import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteFunnels, sites, eq, and } from "@trackme/db";
import { analyzeFunnel, type FunnelStepDefinition } from "@trackme/analytics";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

export async function GET(
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

    // Parse date range from query params (default to last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const from = request.nextUrl.searchParams.get("from") || thirtyDaysAgo.toISOString();
    const to = request.nextUrl.searchParams.get("to") || now.toISOString();

    const analysis = await analyzeFunnel(
      {
        workspaceId: siteRow.workspaceId,
        siteId,
        dateRange: { from, to, granularity: "day" },
      },
      (funnel.steps as unknown as FunnelStepDefinition[]) || []
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

    await authenticateRequest(request, siteRow.workspaceId, "sites:update");

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
