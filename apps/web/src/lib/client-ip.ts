import { isIP } from "node:net";

/**
 * The caller's address, for rate limits and audit rows.
 *
 * X-Forwarded-For is a list each proxy appends to, so only the entries added by proxies we operate
 * can be believed; everything to their left was written by the caller. The client is therefore the
 * entry `TRUSTED_PROXY_HOPS` places from the RIGHT (default 1: one load balancer in front), never the
 * leftmost. Same rule as services/ingestion-go/internal/clientip.
 *
 * Returns "unknown" when the header is missing, too short for the configured hops, or not an IP.
 * That is one shared bucket, which fails closed for rate limits rather than letting a forged value
 * mint a fresh bucket per request.
 */
export function getClientIp(request: { headers: Headers }): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  if (!(hops > 0)) return "unknown";
  const entries = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - hops];
  return candidate && isIP(candidate) ? candidate : "unknown";
}
