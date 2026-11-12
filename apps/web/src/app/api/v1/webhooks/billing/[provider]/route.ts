import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import { processBillingEvent, WebhookSignatureError } from "@trackme/billing";
import { jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { billingProviderId, getGateway, purgeEdgeCache } from "@/lib/billing";

/**
 * POST /api/v1/webhooks/billing/:provider
 *
 * The one entry point for payment-provider events. Authenticated by the provider's signature over the raw body, never
 * by a session. Events are applied idempotently (a redelivery is a no-op), so a failure here returns 5xx and the
 * provider simply retries.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await props.params;
    if (provider !== billingProviderId()) {
      throw new AppError(404, "NOT_FOUND", "Unknown billing provider.");
    }
    await checkRateLimit(`billing_webhook:${getClientIp(request)}`, 600, 60, "Too many webhook calls.");

    const rawBody = await request.text();
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    let events;
    try {
      events = getGateway().verifyAndParseWebhook(rawBody, headers);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        throw new AppError(400, "INVALID_SIGNATURE", "The webhook signature is not valid.");
      }
      throw error;
    }

    const results: { id: string; result: string }[] = [];
    // In order of when they happened, so a checkout is always applied before the payment that follows it.
    for (const event of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
      const outcome = await processBillingEvent(provider, event);
      if (outcome.planChanged) await purgeEdgeCache(outcome.purge);
      results.push({ id: event.id, result: outcome.result });
    }
    return NextResponse.json({ received: results.length, results });
  } catch (error) {
    return jsonError(error);
  }
}
