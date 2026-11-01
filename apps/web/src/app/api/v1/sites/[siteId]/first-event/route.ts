import { NextRequest, NextResponse } from "next/server";
import { getFirstEventStatus } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

async function handleGet(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const { siteId } = await params;
    const { site } = await requireSiteAccess(request, siteId);
    const status = await getFirstEventStatus(site.workspaceId, site.id);
    return NextResponse.json(status);
  } catch (error) {
    return jsonError(error);
  }
}

export const GET = timedRoute("first_event", handleGet);
