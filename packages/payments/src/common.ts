import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { scrubText } from "@trackme/contracts";
import { PAYMENT_METHODS, type PaymentMethod } from "./types.js";

/** Navigates untrusted JSON without ever throwing: `at(obj, "a", "b")` is obj.a.b or undefined. */
export function at(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export const text = (value: unknown, max = 128): string => (typeof value === "string" ? value.slice(0, max) : "");

/** A non-negative whole number of minor units, or null if the gateway sent anything else (a float, a string, a negative). */
export function minorUnits(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Seconds since the epoch (as gateways send them) to ISO UTC; now's value if absent or absurd. */
export function isoFromSeconds(value: unknown, fallbackMs: number): string {
  const seconds = typeof value === "number" && Number.isFinite(value) && value > 946_684_800 && value < 4_102_444_800 ? value : null;
  return new Date(seconds === null ? fallbackMs : seconds * 1000).toISOString();
}

export function method(value: unknown): PaymentMethod {
  const raw = text(value, 32).toLowerCase();
  if (raw === "bank_transfer" || raw === "netbanking" || raw === "net_banking") return "netbanking";
  if (raw === "card" || raw === "debit_card" || raw === "credit_card") return "card";
  if (raw === "emi" || raw === "cardless_emi" || raw === "paylater") return "emi";
  if (raw === "wallet" || raw === "apple_pay" || raw === "google_pay") return "wallet";
  return (PAYMENT_METHODS as readonly string[]).includes(raw) ? (raw as PaymentMethod) : "other";
}

/** A failure code or reason as stored: scrubbed of anything that looks like personal data, capped. */
export const failureText = (value: unknown): string => scrubText(text(value, 200));

/** Hex HMAC-SHA256. */
export const hmacHex = (secret: string, data: string): string => createHmac("sha256", secret).update(data, "utf8").digest("hex");

/**
 * Compares a received hex signature with the expected one without leaking where they differ. Buffers of different
 * length are unequal without being compared (timingSafeEqual would throw); a non-hex input is simply unequal.
 */
export function signaturesMatch(received: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(received) || received.length !== expectedHex.length) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expectedHex, "hex"));
}

export const sha256Hex = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex");

export function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

/** Unix seconds as an ISO time, or "" when the value is not a plausible time (missing, zero, not a number). */
export function isoOrEmpty(value: unknown): string {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 4_102_444_800) return "";
  return new Date(seconds * 1000).toISOString();
}
