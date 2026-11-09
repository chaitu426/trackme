import { NextRequest, NextResponse } from "next/server";
import { getUserSummary, getUserTimelinePage } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { timedRoute } from "@/lib/metrics-registry";

const PAGE_SIZE = 40;
const list = (value: string | null) => (value ? value.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 8) : undefined);

/**
 * One page of a person's timeline, newest first, plus (on the first page) the header summary. Kinds and severities are
 * comma-separated filters; the cursor comes from the previous page. Needs read access to the site.
 */
async function handleGet(
  request: NextRequest,
  props: { params: Promise<{ siteId: string; distinctId: string }> }
) {
  try {
    const { siteId, distinctId } = await props.params;
    const { site } = await requireSiteAccess(request, siteId, "analytics:read");
    const userId = decodeURIComponent(distinctId);
    const search = request.nextUrl.searchParams;
    const cursor = search.get("cursor") ?? undefined;

    const [page, summary] = await Promise.all([
      getUserTimelinePage({
        siteId: site.id,
        userId,
        kinds: list(search.get("kinds")),
        severities: list(search.get("severity")),
        cursor,
        limit: PAGE_SIZE,
      }),
      cursor ? Promise.resolve(null) : getUserSummary(site.id, userId),
    ]);

    return NextResponse.json({ ...page, summary }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export const GET = timedRoute("user_timeline", handleGet);
