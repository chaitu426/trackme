import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { getBillingSummary } from "@trackme/billing";
import { db, workspaces, eq } from "@trackme/db";
import { jsonError } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { getGateway, requireCompanyBilling, safeReturnPath } from "@/lib/billing";

const Body = z.object({
  interval: z.enum(["month", "year"]),
  /** The workspace to come back to, as a slug. */
  workspace: z.string().regex(/^[a-z0-9-]+$/).max(64).optional(),
});

/** POST /api/v1/companies/:id/billing/checkout: starts a hosted checkout for Pro and returns where to send the person. */
export async function POST(request: NextRequest, props: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await props.params;
    const actor = await requireCompanyBilling(request, companyId);
    await checkRateLimit(`billing_checkout:${actor.userId}`, 20, 60 * 60, "Too many checkout attempts. Try again later.");

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "Choose a monthly or yearly plan.");

    const summary = await getBillingSummary(companyId);
    if (summary.plan === "pro" && summary.subscription && ["active", "past_due"].includes(summary.subscription.status)) {
      throw new AppError(409, "ALREADY_SUBSCRIBED", "This company already has a Pro subscription. Change it from the billing page.");
    }

    let slug = parsed.data.workspace;
    if (!slug) {
      const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.companyId, companyId)).limit(1);
      slug = ws?.slug;
    }
    const back = safeReturnPath(slug ? `/${slug}/settings/billing` : undefined, "/");

    const checkout = await getGateway().createCheckout({
      companyId,
      plan: "pro",
      interval: parsed.data.interval,
      email: actor.email,
      successUrl: `${back}?checkout=success`,
      cancelUrl: `${back}?checkout=cancelled`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    return jsonError(error);
  }
}
