import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { getBillingSummary } from "@trackme/billing";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getGateway, requireCompanyBilling } from "@/lib/billing";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("interval"), interval: z.enum(["month", "year"]) }),
]);

/**
 * PATCH /api/v1/companies/:id/billing/subscription
 *
 * cancel: stops renewing at the end of the paid period (Pro stays until then). resume: undoes that. interval: switches
 * monthly/yearly from the next renewal. Each is a request to the provider; the result arrives as a webhook.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await props.params;
    const actor = await requireCompanyBilling(request, companyId);
    await checkRateLimit(`billing_change:${actor.userId}`, 30, 60 * 60, "Too many billing changes. Try again later.");

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "Unknown billing action.");

    const { subscription } = await getBillingSummary(companyId);
    if (!subscription || subscription.provider === "internal" || subscription.status === "canceled") {
      throw new AppError(409, "NO_SUBSCRIPTION", "There is no paid subscription to change.");
    }
    const ref = { companyId, providerSubscriptionId: subscription.providerSubscriptionId };
    const gateway = getGateway();

    switch (parsed.data.action) {
      case "cancel":
        if (subscription.cancelAtPeriodEnd) throw new AppError(409, "ALREADY_CANCELLING", "This subscription is already set to end.");
        await gateway.cancelAtPeriodEnd(ref);
        break;
      case "resume":
        if (!subscription.cancelAtPeriodEnd) throw new AppError(409, "NOT_CANCELLING", "This subscription is not set to end.");
        await gateway.resume(ref);
        break;
      case "interval":
        if (subscription.interval === parsed.data.interval) throw new AppError(409, "SAME_INTERVAL", "That is already the billing interval.");
        await gateway.changeInterval({ ...ref, interval: parsed.data.interval });
        break;
    }
    return NextResponse.json({ summary: await getBillingSummary(companyId) });
  } catch (error) {
    return jsonError(error);
  }
}
