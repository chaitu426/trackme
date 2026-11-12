import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@trackme/contracts";
import {
  DECLINE_MESSAGE,
  assertDemoAllowed,
  cardOutcome,
  completionEvents,
  demoSecret,
  deliverSigned,
  serializeEvents,
  signPayload,
  verifySession,
} from "@trackme/billing";
import { jsonError } from "@/lib/http";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { isDemoBilling, safeReturnPath, webhookUrl } from "@/lib/billing";

const Body = z.object({
  session: z.string().min(10).max(4000),
  card: z.string().max(40),
  /** Set on the second call, after the "authentication" step of the 3-D Secure test card. */
  authenticated: z.boolean().optional(),
});

/**
 * POST /api/v1/billing/demo/complete
 *
 * The demo provider's "pay" button. It decides the outcome from the test card and, when the payment succeeds, reports
 * it the way a real provider would: signed webhooks to our own webhook endpoint. No money moves.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isDemoBilling()) throw new AppError(404, "NOT_FOUND", "Not found.");
    assertDemoAllowed();
    await checkRateLimit(`billing_demo_pay:${getClientIp(request)}`, 30, 15 * 60, "Too many payment attempts. Try again later.");

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(400, "INVALID_INPUT", "Enter a card number.");

    const now = new Date();
    const session = verifySession(demoSecret(), parsed.data.session, now);
    if (!session) throw new AppError(410, "SESSION_EXPIRED", "This checkout has expired. Go back and start again.");

    const outcome = cardOutcome(parsed.data.card);
    if (outcome === "declined" || outcome === "insufficient_funds" || outcome === "unknown") {
      throw new AppError(402, "CARD_ERROR", DECLINE_MESSAGE[outcome]);
    }
    if (outcome === "requires_authentication" && !parsed.data.authenticated) {
      return NextResponse.json({ requiresAuthentication: true });
    }

    const body = serializeEvents(completionEvents(session, now));
    await deliverSigned(webhookUrl("demo"), body, signPayload(demoSecret(), body, Math.floor(now.getTime() / 1000)));
    return NextResponse.json({ ok: true, redirect: safeReturnPath(session.successUrl, "/") });
  } catch (error) {
    return jsonError(error);
  }
}
