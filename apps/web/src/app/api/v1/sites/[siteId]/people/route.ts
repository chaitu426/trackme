import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteUserProfiles, sites, eq, and, desc, sql, ilike, or } from "@trackme/db";
import { authenticateRequest } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

const IdentifyRequestSchema = z.object({
  distinctId: z.string().min(1).max(256),
  anonymousId: z.string().max(128).optional(),
  name: z.string().max(128).optional(),
  email: z.string().email().max(256).optional(),
  traits: z.record(z.unknown()).optional(),
});

export async function GET(
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

    await authenticateRequest(request, siteRow.workspaceId, "read:analytics");

    const search = request.nextUrl.searchParams.get("query")?.trim() || "";
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));

    let query = db
      .select()
      .from(siteUserProfiles)
      .where(eq(siteUserProfiles.siteId, siteId))
      .orderBy(desc(siteUserProfiles.lastSeenAt))
      .limit(limit);

    if (search) {
      query = db
        .select()
        .from(siteUserProfiles)
        .where(
          and(
            eq(siteUserProfiles.siteId, siteId),
            or(
              ilike(siteUserProfiles.distinctId, `%${search}%`),
              ilike(siteUserProfiles.name, `%${search}%`),
              ilike(siteUserProfiles.email, `%${search}%`)
            )
          )
        )
        .orderBy(desc(siteUserProfiles.lastSeenAt))
        .limit(limit) as typeof query;
    }

    const profiles = await query;

    // Summary stats
    const [stats] = await db
      .select({
        totalProfiles: sql<number>`count(*)::int`,
        activePast7Days: sql<number>`count(*) filter (where ${siteUserProfiles.lastSeenAt} >= now() - interval '7 days')::int`,
      })
      .from(siteUserProfiles)
      .where(eq(siteUserProfiles.siteId, siteId));

    return NextResponse.json({
      profiles,
      stats: {
        totalProfiles: stats?.totalProfiles || 0,
        activePast7Days: stats?.activePast7Days || 0,
      },
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
