import { test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectStore } from "@trackme/object-store";
import { PAYMENT_PAYLOAD_RETENTION_DAYS, runPaymentPayloadRetention } from "./payment-payload-retention.js";

const NOW = new Date("2026-11-09T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function fakeStore(objects: Array<{ key: string; modifiedAt: Date }>) {
  const deleted: string[] = [];
  const store: ObjectStore = {
    put: async () => {},
    get: async () => null,
    delete: async (key) => void deleted.push(key),
    list: async (prefix) => objects.filter((o) => o.key.startsWith(prefix)).map((o) => ({ ...o, size: 1 })),
  };
  return { store, deleted };
}

test("payloads older than the window are deleted and newer ones kept", async () => {
  const { store, deleted } = fakeStore([
    { key: "payments/s/2026-06-01/razorpay_a.json", modifiedAt: daysAgo(PAYMENT_PAYLOAD_RETENTION_DAYS + 1) },
    { key: "payments/s/2026-08-15/stripe_b.json", modifiedAt: daysAgo(PAYMENT_PAYLOAD_RETENTION_DAYS - 1) },
    { key: "payments/s/2026-11-08/razorpay_c.json", modifiedAt: daysAgo(1) },
  ]);
  assert.equal(await runPaymentPayloadRetention(store, NOW), 1);
  assert.deepEqual(deleted, ["payments/s/2026-06-01/razorpay_a.json"]);
});

test("only the payments prefix is ever touched", async () => {
  const { store, deleted } = fakeStore([
    { key: "sourcemaps/a/1/old.map", modifiedAt: daysAgo(500) },
    { key: "other/x.bin", modifiedAt: daysAgo(500) },
  ]);
  assert.equal(await runPaymentPayloadRetention(store, NOW), 0);
  assert.deepEqual(deleted, []);
});
