import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, db, eq, sitePaymentGateways, sites } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";
import { decryptSecret } from "@/lib/secret-box";
import { getRedis } from "@/lib/redis";
import { getObjectStore } from "@/lib/sourcemaps";
import { timedRoute } from "@/lib/metrics-registry";
import { handlePaymentWebhook, type WebhookDeps } from "@/lib/payment-webhook";
import { createFailureLimiter, createThrottle } from "@/lib/webhook-guard";
import { secretCache } from "@/lib/payment-secret-cache";
import { getClientIp } from "@/lib/client-ip";

const CLAIM_TTL_SECONDS = 25 * 60 * 60;
/** A caller that sends many rejected requests is turned away before any lookup. */
const failures = createFailureLimiter(30, 60_000);
const touchOncePerMinute = createThrottle(60_000);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const claimKey = (siteId: string, gateway: string, id: string) => `pay_evt:${siteId}:${gateway}:${sha(id).slice(0, 32)}`;

const deps: WebhookDeps = {
  async loadSecret(siteKey, gateway) {
    const cacheKey = `${siteKey}:${gateway}`;
    const cached = secretCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const [row] = await db
      .select({ siteId: sites.id, workspaceId: sites.workspaceId, secretEnc: sitePaymentGateways.secretEnc })
      .from(sites)
      .innerJoin(sitePaymentGateways, eq(sitePaymentGateways.siteId, sites.id))
      .where(and(eq(sites.publicKey, siteKey), eq(sitePaymentGateways.gateway, gateway), eq(sitePaymentGateways.enabled, true)))
      .limit(1);
    const secret = decryptSecret(row?.secretEnc);
    const found = row && secret ? { siteId: row.siteId, workspaceId: row.workspaceId, secret } : null;
    // A "not connected" answer is cached too, so probing random keys cannot be used to hammer the database.
    secretCache.set(cacheKey, found);
    return found;
  },
  async claim(siteId, gateway, id) {
    return (await getRedis("ratelimit").set(claimKey(siteId, gateway, id), "1", "EX", CLAIM_TTL_SECONDS, "NX")) === "OK";
  },
  async release(siteId, gateway, id) {
    await getRedis("ratelimit").del(claimKey(siteId, gateway, id));
  },
  async storeRaw(siteId, gateway, id, body) {
    // Kept 90 days (pruned by the retention job); lets a parser fix be replayed over history.
    const day = new Date().toISOString().slice(0, 10);
    await getObjectStore().put(`payments/${siteId}/${day}/${gateway}_${sha(id).slice(0, 40)}.json`, new TextEncoder().encode(body));
  },
  async insert(siteId, workspaceId, events) {
    await getClickHouseClient().insert({
      table: "payment_events",
      format: "JSONEachRow",
      values: events.map((e) => ({
        workspace_id: workspaceId,
        site_id: siteId,
        gateway: e.gateway,
        gateway_event_id: e.gatewayEventId,
        payment_id: e.paymentId,
        order_id: e.orderId,
        status: e.status,
        amount_minor: e.amountMinor,
        currency: e.currency,
        method: e.method,
        failure_code_raw: e.failureCodeRaw,
        bank: e.bank,
        customer_ref: e.customerRef,
        session_ref: e.sessionRef,
        user_ref: e.userRef,
        created_at: e.createdAt,
      })),
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1, date_time_input_format: "best_effort" },
    });
  },
  async touch(siteId, gateway) {
    if (!touchOncePerMinute(`${siteId}:${gateway}`)) return;
    await db
      .update(sitePaymentGateways)
      .set({ lastEventAt: new Date() })
      .where(and(eq(sitePaymentGateways.siteId, siteId), eq(sitePaymentGateways.gateway, gateway)));
  },
};

/**
 * Receives a payment gateway's webhook. The signature, not a session, is the credential (see lib/payment-webhook.ts).
 * Gateways retry on any non-2xx, so only a failed store answers 500.
 */
async function handlePost(request: NextRequest, ctx: { params: Promise<{ gateway: string; siteKey: string }> }) {
  const { gateway, siteKey } = await ctx.params;
  const caller = getClientIp(request);
  // An address that could not be worked out is one shared bucket, so it is never counted: one sender must not lock out the rest.
  const attributable = caller !== "unknown";
  if (attributable && failures.isBlocked(caller)) return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  const rawBody = await request.text();
  const out = await handlePaymentWebhook({ gateway, siteKey, rawBody, headers: request.headers }, deps);
  // A refused request counts against its sender; a good one never does.
  if (attributable && (out.status === 400 || out.status === 401 || out.status === 404)) failures.recordFailure(caller);
  return NextResponse.json(out.body, { status: out.status });
}

export const POST = timedRoute("payment_webhook", handlePost);
