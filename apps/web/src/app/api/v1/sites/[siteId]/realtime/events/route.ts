import { NextRequest, NextResponse } from "next/server";
import { getRecentEvents } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Tail of the most recently ingested events; the Realtime page refetches it as visitors arrive. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const { site } = await requireSiteAccess(request, siteId);
    const events = await getRecentEvents(site.workspaceId, site.id, 20);
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
