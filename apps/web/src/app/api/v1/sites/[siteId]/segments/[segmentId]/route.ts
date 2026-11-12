import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { db, siteSegments, and, eq } from "@trackme/db";
import { authorizeSite } from "@/lib/site-access";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

async function handleDelete(request: NextRequest, props: { params: Promise<{ siteId: string; segmentId: string }> }) {
  try {
    const { siteId, segmentId } = await props.params;
    await authorizeSite(request, siteId, "sites:update", "people");
    const deleted = await db
      .delete(siteSegments)
      .where(and(eq(siteSegments.id, segmentId), eq(siteSegments.siteId, siteId)))
      .returning({ id: siteSegments.id });
    if (deleted.length === 0) {
      throw new AppError(404, "SEGMENT_NOT_FOUND", "Segment not found.");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export const DELETE = timedRoute("segments_delete", handleDelete);
