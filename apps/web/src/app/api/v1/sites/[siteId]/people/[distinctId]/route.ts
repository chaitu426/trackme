import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { env } from "@trackme/config";
import { db, siteUserProfiles, sites, eq, and } from "@trackme/db";
import { eraseVisitor, getProfile, getUserTimeline } from "@trackme/analytics";
import { overlayServerProfiles } from "@/lib/profiles";
import { authenticateRequest, requireSiteAccess } from "@/lib/tenancy";
import { recordAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

async function handleGet(
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

    await authenticateRequest(request, siteRow.workspaceId, "analytics:read");

    const decodedDistinctId = decodeURIComponent(distinctId);

    // Profile derived from the event stream, with anything a backend set through POST /people laid over it.
    const derived = await getProfile(siteRow.workspaceId, siteId, decodedDistinctId);
    const [profile] = derived ? await overlayServerProfiles(siteId, [derived]) : [];

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

export const GET = timedRoute("person_timeline", handleGet);

/**
 * Right to erasure for one person. A plain DELETE only previews how much would go; add `?confirm=true`
 * to delete it. GET on the same URL is the access/export side (profile plus timeline).
 *
 * Owners and admins only (`data:erase`), interactive sessions only (no API keys). The audit row keeps a
 * keyed hash of the identifier, never the identifier, so the proof that an erasure happened does not
 * itself retain the personal data.
 */
async function handleDelete(
  request: NextRequest,
  props: { params: Promise<{ siteId: string; distinctId: string }> }
) {
  try {
    const { siteId, distinctId } = await props.params;
    const { site, ctx } = await requireSiteAccess(request, siteId, "data:erase");
    const identifier = decodeURIComponent(distinctId);
    const execute = request.nextUrl.searchParams.get("confirm") === "true";

    const result = await eraseVisitor(
      { workspaceId: site.workspaceId, siteId: site.id, identifier },
      { dryRun: !execute }
    );

    if (execute) {
      await db
        .delete(siteUserProfiles)
        .where(and(eq(siteUserProfiles.siteId, site.id), eq(siteUserProfiles.distinctId, identifier)));
      await recordAuditLog({
        workspaceId: site.workspaceId,
        actorId: ctx.userId,
        action: "person.erased",
        targetType: "site",
        targetId: site.id,
        metadata: {
          subject: createHmac("sha256", env.NEXTAUTH_SECRET).update(identifier).digest("hex").slice(0, 32),
          visitors: result.visitors,
          rows: result.rows,
        },
        ipAddress: getClientIp(request),
      });
    }

    return NextResponse.json({
      executed: execute,
      ...result,
      note: execute
        ? "Events and the profile were deleted. Anonymous daily aggregates are not person-level data and are kept."
        : "Preview only. Repeat the request with ?confirm=true to delete.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

export const DELETE = timedRoute("person_erase", handleDelete);
