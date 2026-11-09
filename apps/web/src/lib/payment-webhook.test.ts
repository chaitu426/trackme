import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handlePaymentWebhook, type WebhookDeps } from "./payment-webhook";

const SECRET = "rzp_secret";
const body = JSON.stringify({
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 49900, currency: "INR", method: "upi" } } },
  created_at: 1700000000,
});
const sig = createHmac("sha256", SECRET).update(body).digest("hex");
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

function deps(over: Partial<WebhookDeps> = {}): WebhookDeps & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    loadSecret: async () => ({ siteId: "s1", workspaceId: "w1", secret: SECRET }),
    claim: async (_s, _g, id) => (seen.has(id) ? false : (seen.add(id), true)),
    release: async (_s, _g, id) => void seen.delete(id),
    storeRaw: mock.fn(async () => undefined),
    insert: mock.fn(async () => undefined),
    touch: mock.fn(async () => undefined),
    ...over,
  };
}
const call = (d: WebhookDeps, h: Record<string, string>, b = body, gateway = "razorpay") =>
  handlePaymentWebhook({ gateway, siteKey: "site_pub_x", rawBody: b, headers: headers(h) }, d);

describe("payment webhook", () => {
  it("stores a verified event and inserts it", async () => {
    const d = deps();
    const r = await call(d, { "x-razorpay-signature": sig, "x-razorpay-event-id": "e1" });
    assert.equal(r.status, 200);
    assert.equal(r.body.events, 1);
    assert.equal((d.insert as any).mock.callCount(), 1);
  });
  it("rejects a bad signature without storing anything", async () => {
    const d = deps();
    const r = await call(d, { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "e1" });
    assert.equal(r.status, 401);
    assert.equal((d.storeRaw as any).mock.callCount(), 0);
    assert.equal((d.insert as any).mock.callCount(), 0);
  });
  it("answers 200 and does nothing for a redelivery", async () => {
    const d = deps();
    const h = { "x-razorpay-signature": sig, "x-razorpay-event-id": "e1" };
    await call(d, h);
    const r = await call(d, h);
    assert.deepEqual(r, { status: 200, body: { ok: true, duplicate: true } });
    assert.equal((d.insert as any).mock.callCount(), 1);
  });
  it("releases the id on a failed insert so the retry is processed", async () => {
    const d = deps({ insert: (() => { let n = 0; return async () => { if (n++ === 0) throw new Error("down"); }; })() });
    const h = { "x-razorpay-signature": sig, "x-razorpay-event-id": "e1" };
    assert.equal((await call(d, h)).status, 500);
    assert.equal((await call(d, h)).status, 200);
  });
  it("404s an unknown gateway and a site without the gateway connected, identically", async () => {
    assert.equal((await call(deps(), {}, body, "paypal")).status, 404);
    const r = await call(deps({ loadSecret: async () => null }), { "x-razorpay-signature": sig });
    assert.deepEqual(r, { status: 404, body: { ok: false, reason: "not_connected" } });
  });
  it("rejects an oversized body before looking anything up", async () => {
    const loadSecret = mock.fn(async (): Promise<null> => null);
    const r = await call(deps({ loadSecret }), {}, "x".repeat(300_000));
    assert.equal(r.status, 400);
    assert.equal(loadSecret.mock.callCount(), 0);
  });
});
