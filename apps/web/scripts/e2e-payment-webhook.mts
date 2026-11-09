/**
 * End-to-end check of the payment webhook route: the real handler against the real Postgres, Redis, ClickHouse and object store.
 *
 *   cd apps/web && node --import tsx scripts/e2e-payment-webhook.mts
 *
 * It temporarily connects Razorpay and Stripe on the demo site with throwaway secrets (only for a gateway that is not already
 * connected), sends signed, tampered, stale, duplicate and oversized requests, checks the stored rows contain no personal data,
 * then deletes everything it created (event ids start with "e2e_"). Safe to run against a development stack.
 */
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { and, db, eq, sitePaymentGateways, sites } from "@trackme/db";
import { getClickHouseClient } from "@trackme/analytics";
import { encryptSecret } from "../src/lib/secret-box";
import { getRedis } from "../src/lib/redis";
import { getObjectStore } from "../src/lib/sourcemaps";
import { POST } from "../src/app/api/v1/webhooks/payments/[gateway]/[siteKey]/route";

const SITE_KEY = "site_pub_JI7qJQ5_E0WXH5SRwqJFLx59";
const RZP = "e2e_rzp_secret_123";
const STRIPE = "whsec_e2e_secret_123";
const tag = `e2e_${Date.now()}`;
const ch = getClickHouseClient();
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

async function call(gateway: string, siteKey: string, body: string, headers: Record<string, string>) {
  const req = new NextRequest(`http://localhost:3000/api/v1/webhooks/payments/${gateway}/${siteKey}`, { method: "POST", body, headers });
  const res = await POST(req, { params: Promise.resolve({ gateway, siteKey }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.publicKey, SITE_KEY)).limit(1);
if (!site) throw new Error("site not found");
const existing = await db.select().from(sitePaymentGateways).where(eq(sitePaymentGateways.siteId, site.id));
const had = new Set(existing.map((r) => r.gateway));

try {
  for (const [gateway, secret] of [["razorpay", RZP], ["stripe", STRIPE]] as const) {
    if (!had.has(gateway)) await db.insert(sitePaymentGateways).values({ siteId: site.id, gateway, secretEnc: encryptSecret(secret), enabled: true });
  }
  // If a real secret is already stored we cannot sign for it: only the not-connected path is testable for that gateway.
  const rzpOk = !had.has("razorpay");
  const stripeOk = !had.has("stripe");

  // --- Razorpay
  if (rzpOk) {
    const body = JSON.stringify({ event: "payment.captured", created_at: Math.floor(Date.now() / 1000), payload: { payment: { entity: { id: `pay_${tag}`, order_id: `order_${tag}`, amount: 12345, currency: "INR", method: "upi", vpa: "someone@okhdfcbank", email: "a@b.com", contact: "+911234567890" } } } });
    const sig = createHmac("sha256", RZP).update(body).digest("hex");
    const h = { "x-razorpay-signature": sig, "x-razorpay-event-id": `${tag}_rzp1`, "content-type": "application/json" };
    const t0 = Date.now();
    const a = await call("razorpay", SITE_KEY, body, h);
    check("razorpay: valid event accepted", a.status === 200 && a.body.events === 1, JSON.stringify(a.body) + ` in ${Date.now() - t0}ms`);
    const warmBody = body.replace(`pay_${tag}`, `pay_${tag}w`);
    const warmSig = createHmac("sha256", RZP).update(warmBody).digest("hex");
    const t1 = Date.now();
    const w = await call("razorpay", SITE_KEY, warmBody, { ...h, "x-razorpay-signature": warmSig, "x-razorpay-event-id": `${tag}_rzpw` });
    check("razorpay: a second distinct event is accepted", w.status === 200 && w.body.events === 1, `${Date.now() - t1} ms from here (two remote calls: Redis, then ClickHouse; a few ms when they sit beside the app)`);
    const b = await call("razorpay", SITE_KEY, body, h);
    check("razorpay: redelivery is a duplicate", b.status === 200 && b.body.duplicate === true);
    const c = await call("razorpay", SITE_KEY, body, { ...h, "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": `${tag}_rzp2` });
    check("razorpay: bad signature is 401", c.status === 401, JSON.stringify(c.body));
    const rows = (await (await ch.query({ query: `SELECT * FROM growth_analytics.payment_events FINAL WHERE gateway_event_id = {id:String}`, query_params: { id: `${tag}_rzp1` }, format: "JSONEachRow" })).json()) as Array<Record<string, unknown>>;
    check("razorpay: one normalised row stored", rows.length === 1 && Number(rows[0]!.amount_minor) === 12345 && rows[0]!.status === "captured" && rows[0]!.method === "upi", JSON.stringify(rows[0] ?? {}).slice(0, 160));
    const dump = JSON.stringify(rows);
    check("razorpay: no email, phone or UPI handle in the stored row", !/a@b\.com|1234567890|someone@/.test(dump));
    const last = await db.select({ at: sitePaymentGateways.lastEventAt }).from(sitePaymentGateways).where(and(eq(sitePaymentGateways.siteId, site.id), eq(sitePaymentGateways.gateway, "razorpay")));
    check("razorpay: last event time updated", Boolean(last[0]?.at));
    const raw = await getObjectStore().list(`payments/${site.id}`);
    check("razorpay: raw payload kept in the object store", raw.some((o) => o.key.includes("razorpay_")), `${raw.length} object(s)`);
  } else console.log("SKIP  razorpay signed tests: a real secret is already connected");

  // --- Stripe
  if (stripeOk) {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: `${tag}_stripe1`, type: "payment_intent.succeeded", created: now, data: { object: { id: `pi_${tag}`, amount: 2900, currency: "usd", metadata: { order_id: `order_${tag}s` }, payment_method_types: ["card"] } } });
    const sig = createHmac("sha256", STRIPE).update(`${now}.${body}`).digest("hex");
    const a = await call("stripe", SITE_KEY, body, { "stripe-signature": `t=${now},v1=${sig}` });
    check("stripe: valid event accepted", a.status === 200 && a.body.events === 1, JSON.stringify(a.body));
    const old = now - 3600;
    const sigOld = createHmac("sha256", STRIPE).update(`${old}.${body}`).digest("hex");
    const b = await call("stripe", SITE_KEY, body.replace(`${tag}_stripe1`, `${tag}_stripe2`), { "stripe-signature": `t=${old},v1=${sigOld}` });
    check("stripe: a stale signature is refused", b.status === 401, JSON.stringify(b.body));
  } else console.log("SKIP  stripe signed tests: a real secret is already connected");

  // --- routing
  const u = await call("paypal", SITE_KEY, "{}", {});
  check("unknown gateway is 404", u.status === 404);
  const n = await call("razorpay", "site_pub_does_not_exist", "{}", { "x-razorpay-signature": "x" });
  check("unknown site is 404", n.status === 404);
  const big = await call("razorpay", SITE_KEY, "x".repeat(300_000), {});
  check("oversized body is 400", big.status === 400);
} finally {
  const opts = { clickhouse_settings: { mutations_sync: 2 as const } };
  await ch.command({ query: `ALTER TABLE growth_analytics.payment_events DELETE WHERE site_id = '${site.id}' AND startsWith(gateway_event_id, '${tag}')`, ...opts }).catch(() => undefined);
  const store = getObjectStore();
  for (const o of await store.list(`payments/${site.id}`)) {
    if (/razorpay_|stripe_/.test(o.key) && Date.now() - o.modifiedAt.getTime() < 10 * 60_000) await store.delete(o.key).catch(() => undefined);
  }
  const redis = getRedis("ratelimit");
  for (const k of await redis.keys("pay_evt:*")) await redis.del(k);
  for (const g of ["razorpay", "stripe"]) {
    if (!had.has(g)) await db.delete(sitePaymentGateways).where(and(eq(sitePaymentGateways.siteId, site.id), eq(sitePaymentGateways.gateway, g)));
  }
  console.log("cleaned up");
}
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
