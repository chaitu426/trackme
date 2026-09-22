import { NextRequest, NextResponse } from "next/server";
import { getFirstEventStatus } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

export async function GET(
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
