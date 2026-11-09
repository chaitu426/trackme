import { NextRequest, NextResponse } from "next/server";
import { getRevenueLeaks, leaksToCsv } from "@trackme/analytics";
import { requireSiteAccess } from "@/lib/tenancy";
import { jsonError } from "@/lib/http";
import { parseRangeKey } from "@/lib/date-range";
import { paymentRanges } from "@/lib/payments-view";

/** The Revenue Leaks ranking as a CSV file, for the same range the page shows. Needs read access to the site. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await params;
    const { site } = await requireSiteAccess(request, siteId);
    const range = parseRangeKey(request.nextUrl.searchParams.get("range") ?? undefined);
    const { current } = paymentRanges(range);
    const data = await getRevenueLeaks(siteId, current);
    const name = `revenue-leaks-${site.domain.replace(/[^a-z0-9.-]/gi, "_")}-${current.from}_${current.to}.csv`;
    return new NextResponse(leaksToCsv(data), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
