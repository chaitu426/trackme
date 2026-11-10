import { createObjectStore, type ObjectStore } from "@trackme/object-store";

/**
 * The raw webhook bodies exist so a parser fix can be replayed over recent history. Ninety days is enough for that; the normalised
 * rows (payment_events) keep 25 months for audit and do not depend on these files.
 */
export const PAYMENT_PAYLOAD_RETENTION_DAYS = 90;
const PREFIX = "payments";

/** Deletes raw payment payloads older than the window. One listing of the `payments` prefix, then deletes. Returns how many were removed. */
export async function runPaymentPayloadRetention(store: ObjectStore = createObjectStore(), now: Date = new Date()): Promise<number> {
  const cutoff = now.getTime() - PAYMENT_PAYLOAD_RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const object of await store.list(PREFIX)) {
    if (object.modifiedAt.getTime() < cutoff) {
      await store.delete(object.key);
      removed += 1;
    }
  }
  return removed;
}
