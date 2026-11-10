import { getGateway, type PaymentEvent } from "@trackme/payments";

/**
 * Everything the webhook needs from the outside world, so the decision logic can be tested without a network.
 * The route wires the real implementations (Postgres, Redis, object store, ClickHouse).
 */
export interface WebhookDeps {
  /** The decrypted signing secret for this site and gateway, or null when not connected or disabled. */
  loadSecret(siteKey: string, gateway: string): Promise<{ siteId: string; workspaceId: string; secret: string } | null>;
  /** True the first time an id is seen (SET NX); false for a redelivery. */
  claim(siteId: string, gateway: string, eventId: string): Promise<boolean>;
  /** Give the id back after a failed store so the gateway's retry is not swallowed. */
  release(siteId: string, gateway: string, eventId: string): Promise<void>;
  storeRaw(siteId: string, gateway: string, eventId: string, body: string): Promise<void>;
  insert(siteId: string, workspaceId: string, events: PaymentEvent[]): Promise<void>;
  touch(siteId: string, gateway: string): Promise<void>;
}

export interface WebhookOutcome {
  status: 200 | 400 | 401 | 404 | 500;
  body: { ok: boolean; reason?: string; duplicate?: boolean; events?: number };
}

export const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Order of checks matters: an unknown gateway or site is a 404 before any work; a bad signature is a 401 before the body is
 * parsed; a duplicate is a 200 (the gateway must stop retrying) and is not stored again.
 */
export async function handlePaymentWebhook(
  input: { gateway: string; siteKey: string; rawBody: string; headers: { get(name: string): string | null } },
  deps: WebhookDeps,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<WebhookOutcome> {
  const adapter = getGateway(input.gateway);
  if (!adapter) return { status: 404, body: { ok: false, reason: "unknown_gateway" } };
  if (input.rawBody.length > MAX_WEBHOOK_BYTES) return { status: 400, body: { ok: false, reason: "too_large" } };

  const conn = await deps.loadSecret(input.siteKey, adapter.id);
  // Same answer for an unknown site and a gateway that is not connected, so keys cannot be probed.
  if (!conn) return { status: 404, body: { ok: false, reason: "not_connected" } };

  const verdict = adapter.verifyWebhook(input.rawBody, input.headers, conn.secret, nowSeconds);
  if (!verdict.ok) {
    return { status: verdict.reason === "malformed" ? 400 : 401, body: { ok: false, reason: verdict.reason } };
  }

  const eventId = adapter.eventId(input.rawBody, input.headers);
  if (!(await deps.claim(conn.siteId, adapter.id, eventId))) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  try {
    const events = adapter.normalize(input.rawBody, eventId);
    // Independent writes, so they run together: the answer takes as long as the slower one, not the sum.
    await Promise.all([
      deps.storeRaw(conn.siteId, adapter.id, eventId, input.rawBody),
      events.length > 0 ? deps.insert(conn.siteId, conn.workspaceId, events) : Promise.resolve(),
    ]);
    // The "last event" stamp is bookkeeping; it must not delay the answer or fail the request.
    void deps.touch(conn.siteId, adapter.id).catch(() => undefined);
    return { status: 200, body: { ok: true, events: events.length } };
  } catch {
    await deps.release(conn.siteId, adapter.id, eventId).catch(() => undefined);
    // 500 makes the gateway retry, which is the right outcome for a transient store failure.
    return { status: 500, body: { ok: false, reason: "store_failed" } };
  }
}
