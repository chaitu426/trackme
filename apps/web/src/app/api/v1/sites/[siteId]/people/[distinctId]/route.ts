import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteUserProfiles, sites, eq, and } from "@trackme/db";
import { getUserTimeline } from "@trackme/analytics";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ siteId: string; distinctId: string }> }
) {
  try {
    const { siteId, distinctId } = await props.params;

    const [siteRow] = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);

    if (!siteRow) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
    }

    await authenticateRequest(request, siteRow.workspaceId, "read:analytics");

    const decodedDistinctId = decodeURIComponent(distinctId);

    // Profile from Postgres
    const [profile] = await db
      .select()
      .from(siteUserProfiles)
      .where(
        and(
          eq(siteUserProfiles.siteId, siteId),
          eq(siteUserProfiles.distinctId, decodedDistinctId)
        )
      )
      .limit(1);

    // Event timeline from ClickHouse
    const timeline = await getUserTimeline({
      workspaceId: siteRow.workspaceId,
      siteId,
      identifier: decodedDistinctId,
      limit: 100,
    });

    return NextResponse.json({
      profile: profile || {
        distinctId: decodedDistinctId,
        traits: {},
        firstSeenAt: timeline[timeline.length - 1]?.timestamp || new Date().toISOString(),
        lastSeenAt: timeline[0]?.timestamp || new Date().toISOString(),
        totalEvents: timeline.length,
        totalSessions: new Set(timeline.map((e) => (e.properties as any)?.sessionId)).size || 1,
      },
      timeline,
    });
  } catch (error) {
    return jsonError(error);
  }
}
