import { NextRequest, NextResponse } from "next/server";
import { startTrial, getBillingSummary } from "@trackme/billing";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { purgeEdgeCache, requireCompanyBilling } from "@/lib/billing";

/** POST /api/v1/companies/:id/billing/trial: the one free 14-day Pro trial, no card needed. */
export async function POST(request: NextRequest, props: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await props.params;
    const actor = await requireCompanyBilling(request, companyId);
    await checkRateLimit(`billing_trial:${actor.userId}`, 5, 60 * 60, "Too many attempts. Try again later.");
    const { purge } = await startTrial(companyId);
    await purgeEdgeCache(purge);
    return NextResponse.json({ summary: await getBillingSummary(companyId) });
  } catch (error) {
    return jsonError(error);
  }
}
