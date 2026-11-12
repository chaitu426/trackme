import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { getBillingSummary, renewalEvent, runBillingMaintenance, serializeEvents, signPayload, demoSecret, deliverSigned } from "@trackme/billing";
import { db, subscriptions, eq } from "@trackme/db";
import { jsonError } from "@/lib/http";
import { isDemoBilling, purgeEdgeCache, requireCompanyBilling, webhookUrl } from "@/lib/billing";

const Body = z.object({ action: z.enum(["renew_ok", "renew_fail", "expire_trial", "expire_grace", "end_period"]) });

/**
 * POST /api/v1/companies/:id/billing/demo-clock
 *
 * Development and staging only, and only while the demo gateway is active: acts as the payment provider's clock so
 * renewals, failures and expiries can be tried without waiting. It does not exist in a production build.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ companyId: string }> }) {
  try {
    if (process.env.NODE_ENV === "production" || !isDemoBilling()) {
      throw new AppError(404, "NOT_FOUND", "Not found.");
    }
    const { companyId } = await props.params;
    await requireCompanyBilling(request, companyId);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "Unknown clock action.");

    const { subscription } = await getBillingSummary(companyId);
    if (!subscription) throw new AppError(409, "NO_SUBSCRIPTION", "There is no subscription to move.");
    const now = new Date();
    const past = new Date(now.getTime() - 60 * 1000);

    switch (parsed.data.action) {
      case "renew_ok":
      case "renew_fail": {
        const event = renewalEvent({ companyId, interval: subscription.interval, periodEnd: subscription.currentPeriodEnd ?? now, now, ok: parsed.data.action === "renew_ok" });
        const body = serializeEvents([event]);
        await deliverSigned(webhookUrl("demo"), body, signPayload(demoSecret(), body, Math.floor(now.getTime() / 1000)));
        break;
      }
      case "expire_trial":
        await db.update(subscriptions).set({ trialEnd: past }).where(eq(subscriptions.companyId, companyId));
        break;
      case "expire_grace":
        await db.update(subscriptions).set({ graceEndsAt: past }).where(eq(subscriptions.companyId, companyId));
        break;
      case "end_period":
        await db.update(subscriptions).set({ currentPeriodEnd: past }).where(eq(subscriptions.companyId, companyId));
        break;
    }
    // The nightly job's work, run now so the effect of the move is visible straight away.
    const result = await runBillingMaintenance(now);
    await purgeEdgeCache(result.purge);
    return NextResponse.json({ summary: await getBillingSummary(companyId), maintenance: { changed: result.changed.length } });
  } catch (error) {
    return jsonError(error);
  }
}
