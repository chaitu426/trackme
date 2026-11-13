import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteUserProfiles, sites, eq, and, sql } from "@trackme/db";
import { listProfiles, profileStats } from "@trackme/analytics";
import { findServerProfileIds, overlayServerProfiles } from "@/lib/profiles";
import { authenticateSite } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

const IdentifyRequestSchema = z.object({
  distinctId: z.string().min(1).max(256),
  anonymousId: z.string().max(128).optional(),
  name: z.string().max(128).optional(),
  email: z.string().email().max(256).optional(),
  traits: z.record(z.unknown()).optional(),
});

async function handleGet(
  request: NextRequest,
  props: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await props.params;

    // Resolve site to find workspaceId
    const [siteRow] = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);

    if (!siteRow) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
    }

    await authenticateSite(request, siteRow.workspaceId, siteId, "analytics:read", "people");

    const search = request.nextUrl.searchParams.get("query")?.trim() || "";
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));
    const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || 0) || 0);

    // People are derived from the event stream in ClickHouse; a backend's POST /people adds name/email on top.
    const alsoIds = search ? await findServerProfileIds(siteId, search) : [];
    const [page, stats] = await Promise.all([
      listProfiles({ workspaceId: siteRow.workspaceId, siteId, search, alsoIds, limit, offset }),
      profileStats(siteRow.workspaceId, siteId),
    ]);
    const profiles = (await overlayServerProfiles(siteId, page.profiles)).map((p) => ({ ...p, anonymousId: null }));

    return NextResponse.json({
      profiles,
      hasMore: page.hasMore,
      stats: { totalProfiles: stats.total, activePast7Days: stats.active7d },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await props.params;

    const [siteRow] = await db
      .select({ id: sites.id, workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);

    if (!siteRow) {
      throw new AppError(404, "SITE_NOT_FOUND", "Site not found.");
    }

    // This endpoint had no authorization check beyond "has a session", so any signed-in user of any workspace
    // could write profiles into any site. Require update rights on THIS site's workspace.
    await authenticateSite(request, siteRow.workspaceId, siteId, "sites:update", "people");

    const body = await request.json().catch(() => ({}));
    const parsed = IdentifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_INPUT", "Invalid identify payload.");
    }

    const { distinctId, anonymousId, name, email, traits } = parsed.data;

    // Upsert user profile
    const existing = await db
      .select()
      .from(siteUserProfiles)
      .where(and(eq(siteUserProfiles.siteId, siteId), eq(siteUserProfiles.distinctId, distinctId)))
      .limit(1);

    const now = new Date();

    if (existing[0]) {
      const mergedTraits = {
        ...((existing[0].traits as Record<string, unknown>) || {}),
        ...(traits || {}),
      };

      const [updated] = await db
        .update(siteUserProfiles)
        .set({
          anonymousId: anonymousId || existing[0].anonymousId,
          name: name || existing[0].name,
          email: email || existing[0].email,
          traits: mergedTraits,
          totalEvents: sql`${siteUserProfiles.totalEvents} + 1`,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(siteUserProfiles.id, existing[0].id))
        .returning();

      return NextResponse.json({ profile: updated, isNew: false });
    }

    const [created] = await db
      .insert(siteUserProfiles)
      .values({
        siteId,
        distinctId,
        anonymousId: anonymousId || null,
        name: name || null,
        email: email || null,
        traits: traits || {},
        totalSessions: 1,
        totalEvents: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning();

    return NextResponse.json({ profile: created, isNew: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export const GET = timedRoute("people", handleGet);
