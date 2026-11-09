import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, db, eq, sitePaymentGateways, sites } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";
import { decryptSecret } from "@/lib/secret-box";
import { getRedis } from "@/lib/redis";
import { getObjectStore } from "@/lib/sourcemaps";
import { timedRoute } from "@/lib/metrics-registry";
import { handlePaymentWebhook, type WebhookDeps } from "@/lib/payment-webhook";

const CLAIM_TTL_SECONDS = 25 * 60 * 60;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const claimKey = (siteId: string, gateway: string, id: string) => `pay_evt:${siteId}:${gateway}:${sha(id).slice(0, 32)}`;

const deps: WebhookDeps = {
  async loadSecret(siteKey, gateway) {
    const [row] = await db
      .select({ siteId: sites.id, workspaceId: sites.workspaceId, secretEnc: sitePaymentGateways.secretEnc })
      .from(sites)
      .innerJoin(sitePaymentGateways, eq(sitePaymentGateways.siteId, sites.id))
      .where(and(eq(sites.publicKey, siteKey), eq(sitePaymentGateways.gateway, gateway), eq(sitePaymentGateways.enabled, true)))
      .limit(1);
    const secret = decryptSecret(row?.secretEnc);
    return row && secret ? { siteId: row.siteId, workspaceId: row.workspaceId, secret } : null;
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
  const rawBody = await request.text();
  const out = await handlePaymentWebhook({ gateway, siteKey, rawBody, headers: request.headers }, deps);
  return NextResponse.json(out.body, { status: out.status });
}

export const POST = timedRoute("payment_webhook", handlePost);
