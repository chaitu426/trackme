import { NextRequest, NextResponse } from "next/server";
import { getBillingSummary, priceFor } from "@trackme/billing";
import { jsonError } from "@/lib/http";
import { isDemoBilling, requireCompanyBilling } from "@/lib/billing";

/** GET /api/v1/companies/:id/billing: the plan, subscription, prices and recent invoices. */
export async function GET(request: NextRequest, props: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await props.params;
    await requireCompanyBilling(request, companyId);
    const summary = await getBillingSummary(companyId);
    return NextResponse.json({
      ...summary,
      prices: { month: priceFor("month"), year: priceFor("year") },
      demo: isDemoBilling(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
