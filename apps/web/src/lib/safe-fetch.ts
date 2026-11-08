import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

/**
 * The only way this application should call a URL that a user supplied (alert webhooks and anything like them).
 *
 * A plain fetch(url) lets a user aim the server at its own network: cloud metadata (169.254.169.254, which
 * hands out the machine's credentials), localhost, and the private addresses of the database, cache and broker.
 * This module defends against that at the only place it can be done reliably, the connection itself:
 *   1. https only; no credentials in the URL.
 *   2. The hostname is resolved HERE, and every address it resolves to must be public. If any is private,
 *      loopback, link-local, multicast or otherwise reserved the call is refused.
 *   3. The connection is then made to the address that was checked (the lookup is pinned), so DNS cannot
 *      return a different, internal address a moment later ("DNS rebinding"). TLS still validates the hostname.
 *   4. Redirects are never followed (a public host cannot bounce the request to an internal one).
 *   5. A hard deadline, and the response body is discarded, so a slow or enormous reply costs nothing and an
 *      internal service's error page can never be read back through us.
 * The result is only the HTTP status.
 */

/** Reserved IPv4 ranges as [network, prefix length]. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function blockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([net_, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(net_) & mask);
  });
}

/** Expands an IPv6 address (including "::" and a trailing dotted IPv4) to its 16 bytes. */
function v6Bytes(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0]!; // drop any zone id
  let tail: number[] = [];
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1]!.split(".").map(Number);
    if (o.length !== 4 || o.some((x) => x > 255)) return null;
    tail = o;
    text = text.slice(0, -dotted[1]!.length) + "0:0";
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = groups(halves[0]!);
  const rest = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const g of all) {
    const v = parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/.test(g) || Number.isNaN(v)) return null;
    bytes.push(v >> 8, v & 255);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes.length === 16 ? bytes : null;
}

/** True for any address a user-supplied URL must never be allowed to reach. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return blockedV4(ip);
  if (!net.isIPv6(ip)) return true; // not an address we understand: refuse
  const b = v6Bytes(ip);
  if (!b) return true;
  const embedded = (i: number) => b.slice(i, i + 4).join(".");
  const allZeroUntil = (n: number) => b.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (allZeroUntil(10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(embedded(12)); // ::ffff:a.b.c.d
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return blockedV4(embedded(12)); // 64:ff9b::/96 (NAT64)
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(embedded(2)); // 2002::/16 (6to4)
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) >= 0x80) return true; // fe80::/10 link-local and fec0::/10 site-local
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Parses and checks the URL itself, before any network access. */
export function parseOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("The URL is not valid.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https:// URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError("That address is not allowed.");
  } else if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || host === "localhost") {
    throw new UnsafeUrlError("That host name is not allowed.");
  }
  return url;
}

/** Resolves the host and returns an address that is safe to connect to; throws if any resolved address is not. */
export async function resolvePublicAddress(
  hostname: string,
  lookup: (host: string) => Promise<Array<{ address: string; family: number }>> = (h) => dns.lookup(h, { all: true, verbatim: true })
): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const found = net.isIP(host) ? [{ address: host, family: net.isIPv4(host) ? 4 : 6 }] : await lookup(host);
  if (found.length === 0) throw new UnsafeUrlError("The host name did not resolve.");
  // Every answer must be public: a name that also points at an internal address is refused outright.
  if (found.some((a) => isBlockedAddress(a.address))) throw new UnsafeUrlError("That host resolves to a private address.");
  const first = found[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

export interface SafePostOptions {
  headers?: Record<string, string>;
  body: string;
  timeoutMs?: number;
}

/** POSTs to a user-supplied URL under the rules above. Resolves with the HTTP status only. */
export async function safePost(rawUrl: string, options: SafePostOptions): Promise<{ status: number; ok: boolean }> {
  const url = parseOutboundUrl(rawUrl);
  const target = await resolvePublicAddress(url.hostname);
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: { ...options.headers, "Content-Length": Buffer.byteLength(options.body).toString() },
        // Connect to the address that was just checked. (Node may ask for one address or for a list.)
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts && opts.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)) as never,
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // read nothing: the body is never used, and never returned
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300 });
      }
    );
    const deadline = setTimeout(() => req.destroy(new Error("The request timed out.")), timeoutMs);
    req.on("timeout", () => req.destroy(new Error("The request timed out.")));
    req.on("error", (err) => {
      clearTimeout(deadline);
      reject(err);
    });
    req.on("close", () => clearTimeout(deadline));
    req.end(options.body);
  });
}
