import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { authorizeSite } from "@/lib/site-access";
import { SegmentDefinitionSchema } from "@/lib/segment-schema";
import { evaluateSegment } from "@/lib/segments";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

/** Who matches a definition right now. Used by the builder's live count and when a saved segment is opened. */
async function handlePost(request: NextRequest, props: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await props.params;
    const access = await authorizeSite(request, siteId, "analytics:read", "people");

    const parsed = SegmentDefinitionSchema.safeParse((await request.json().catch(() => null))?.definition);
    if (!parsed.success) {
      throw new AppError(400, "INVALID_SEGMENT", parsed.error.issues[0]?.message ?? "Invalid segment.");
    }

    const result = await evaluateSegment(access.workspaceId, siteId, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export const POST = timedRoute("segments_preview", handlePost);
