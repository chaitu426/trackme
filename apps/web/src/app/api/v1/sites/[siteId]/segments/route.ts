import { withPlanLimit } from "@/lib/plan";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteSegments, eq, desc } from "@trackme/db";
import { authorizeSite } from "@/lib/site-access";
import { SegmentDefinitionSchema } from "@/lib/segment-schema";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

const CreateSegmentSchema = z.object({
  name: z.string().trim().min(1, "Give the segment a name").max(80),
  definition: SegmentDefinitionSchema,
});

const MAX_SEGMENTS_PER_SITE = 50;

/** A missing table means the one-time migration has not been applied yet. */
function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

async function handleGet(request: NextRequest, props: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await props.params;
    await authorizeSite(request, siteId, "analytics:read");
    const segments = await db
      .select({ id: siteSegments.id, name: siteSegments.name, definition: siteSegments.definition, createdAt: siteSegments.createdAt })
      .from(siteSegments)
      .where(eq(siteSegments.siteId, siteId))
      .orderBy(desc(siteSegments.createdAt));
    return NextResponse.json({ segments });
  } catch (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { code: "SEGMENTS_NOT_SET_UP", message: "Saved segments need a one-time database update (node packages/db/apply-segments.mjs)." },
        { status: 503 }
      );
    }
    return jsonError(error);
  }
}

async function handlePost(request: NextRequest, props: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await props.params;
    const access = await authorizeSite(request, siteId, "sites:update");

    const parsed = CreateSegmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "INVALID_SEGMENT", parsed.error.issues[0]?.message ?? "Invalid segment.");
    }

    const existing = await db.select({ id: siteSegments.id }).from(siteSegments).where(eq(siteSegments.siteId, siteId));
    if (existing.length >= MAX_SEGMENTS_PER_SITE) {
      throw new AppError(400, "SEGMENT_LIMIT", `A site can have up to ${MAX_SEGMENTS_PER_SITE} segments.`);
    }

    try {
      const [created] = await withPlanLimit({ resource: "segments", workspaceId: access.workspaceId }, (tx) =>
        tx
          .insert(siteSegments)
          .values({ siteId, name: parsed.data.name, definition: parsed.data.definition, createdBy: access.userId })
          .returning({ id: siteSegments.id, name: siteSegments.name, definition: siteSegments.definition, createdAt: siteSegments.createdAt })
      );
      return NextResponse.json({ segment: created }, { status: 201 });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") throw new AppError(409, "SEGMENT_EXISTS", "A segment with that name already exists.");
      throw error;
    }
  } catch (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { code: "SEGMENTS_NOT_SET_UP", message: "Saved segments need a one-time database update (node packages/db/apply-segments.mjs)." },
        { status: 503 }
      );
    }
    return jsonError(error);
  }
}

export const GET = timedRoute("segments_list", handleGet);
export const POST = timedRoute("segments_create", handlePost);
