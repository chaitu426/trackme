/**
 * Content-Security-Policy for the dashboard, built per request with a fresh nonce.
 *
 * Scripts run only if they carry the request's nonce ('strict-dynamic' lets those scripts load their own
 * chunks), which is what stops an injected <script> from executing even if some page ever renders
 * attacker-controlled HTML. Styles allow 'unsafe-inline' because the UI library sets style attributes; that is a
 * much smaller risk than inline script and is the usual trade.
 *
 * CSP_MODE controls rollout: "report-only" (default: violations are reported, nothing is blocked), "enforce",
 * or "off". Ship report-only, watch /api/security/csp-report (or the browser console) for violations from real
 * pages, fix or allow them, then set CSP_MODE=enforce. Development is not covered: its tooling needs eval.
 *
 * The directives that never break a page (frame-ancestors, base-uri, form-action, object-src) are enforced
 * unconditionally in next.config.ts, so clickjacking and base-tag injection are closed even in report-only.
 */
export type CspMode = "enforce" | "report-only" | "off";

export function cspMode(value: string | undefined): CspMode {
  return value === "enforce" || value === "off" ? value : "report-only";
}

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://flagcdn.com https://cdn.jsdelivr.net",
    "font-src 'self' data:",
    "connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    "report-uri /api/security/csp-report",
  ].join("; ");
}

/** The response header to send for a mode, or null when the policy is off. */
export function cspHeader(mode: CspMode, nonce: string): { name: string; value: string } | null {
  if (mode === "off") return null;
  return {
    name: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value: buildCsp(nonce),
  };
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
