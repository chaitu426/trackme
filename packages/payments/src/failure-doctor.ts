/**
 * The Payment Failure Doctor: turns a gateway's raw failure code (plus a little context) into a category a person can act on.
 *
 * The rules are data, not code. DEFAULT_RULES below is the seed table; a deployment can replace it with a JSON file (see
 * parseRules) without touching the classifier. Order of evaluation: rules that match the gateway's own code first, then rules that
 * look at the context around the failure, then "unknown". The matched rule's id is stored with every classification, so a number on
 * a dashboard can always be explained by the rule that produced it.
 */

export const FAILURE_CATEGORIES = [
  "insufficient_funds",
  "bank_decline",
  "auth_failed",
  "upi_timeout",
  "upi_pending_expired",
  "gateway_outage",
  "network_error",
  "app_bug",
  "user_abandon",
  "fraud_block",
  "unknown",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** What is known about the moment of the failure, beyond the code. Built by the classifier job from other tables. */
export interface FailureContext {
  gateway: string;
  method: string;
  /** Errors the shopper's browser reported in the same session in the two minutes before the failure. */
  sameSessionErrors: number;
  /** The gateway's success rate around that time (0 to 1), or null when there was too little traffic to say. */
  gatewaySuccessRate: number | null;
  /** How many payments that rate is based on. */
  gatewayVolume: number;
  /** Seconds between the payment starting and failing, or null when the start was not seen. */
  secondsToFail: number | null;
}

export interface FailureInput {
  gateway: string;
  method: string;
  /** The raw code as stored, for example "customer:payment_authentication:otp_incorrect:BAD_REQUEST_ERROR". */
  code: string;
  context: FailureContext;
}

export type ContextSignal = "session_error" | "gateway_degraded" | "slow_failure";

export interface FailureRule {
  id: string;
  category: FailureCategory;
  /** Limits the rule to one gateway or method. Omit to match any. */
  gateway?: string;
  method?: string;
  /** Matches when the code contains any of these (compared lower case). Omit for a rule that looks only at the context. */
  codeIncludes?: string[];
  /** Every listed signal must hold. */
  signals?: ContextSignal[];
}

/** A gateway below this success rate, with enough payments behind it, counts as degraded. */
export const DEGRADED_RATE = 0.5;
export const DEGRADED_MIN_VOLUME = 8;
/** A failure that took this long after the payment started looks like a timeout rather than a refusal. */
export const SLOW_FAILURE_SECONDS = 180;

/**
 * The seed rules. Code rules come first and more specific rules before general ones: "upi_limit_exceeded" must reach the
 * bank rule, not the upi-expired rule, so the expired rule asks for "expired" or "pending" explicitly; and a gateway's own failure
 * ("gateway_timeout") is checked before the method rules so a UPI payment is not blamed on the UPI app.
 */
export const DEFAULT_RULES: FailureRule[] = [
  { id: "funds-1", category: "insufficient_funds", codeIncludes: ["insufficient_funds", "insufficient funds", "insufficient_balance"] },
  { id: "fraud-1", category: "fraud_block", codeIncludes: ["fraud", "risk_", "stolen", "lost_card", "pickup_card", "blocked_by", "restricted"] },
  { id: "abandon-1", category: "user_abandon", codeIncludes: ["abandon", "cancelled", "canceled", "closed_by_user", "payment_cancelled"] },
  // The gateway's own failures come before the method rules: "gateway_timeout" on a UPI payment is the gateway, not the UPI app.
  { id: "gateway-1", category: "gateway_outage", codeIncludes: ["gateway_timeout", "gateway_technical_error", "gateway_error", "gateway:", "server_error", "service_unavailable"] },
  { id: "upi-expired-1", category: "upi_pending_expired", method: "upi", codeIncludes: ["collect_request", "expired", "pending"] },
  { id: "upi-timeout-1", category: "upi_timeout", method: "upi", codeIncludes: ["timeout", "timed_out", "no_response"] },
  { id: "auth-1", category: "auth_failed", codeIncludes: ["3ds", "otp", "authentication", "wrong_pin", "incorrect_pin", "incorrect_cvc", "incorrect_cvv", "cvv", "authorization_required", "authentication_required"] },
  { id: "network-1", category: "network_error", codeIncludes: ["network", "connection", "timeout", "timed_out"] },
  { id: "bank-1", category: "bank_decline", codeIncludes: ["card_declined", "declined", "do_not_honor", "expired_card", "invalid_account", "limit_exceeded", "not_permitted", "bank:", "issuer", "generic_decline"] },
  // Context rules: only reached when the code explained nothing.
  { id: "ctx-gateway", category: "gateway_outage", signals: ["gateway_degraded"] },
  { id: "ctx-app", category: "app_bug", signals: ["session_error"] },
  { id: "ctx-slow", category: "network_error", signals: ["slow_failure"] },
];

export interface Classification {
  category: FailureCategory;
  /** The rule that decided it, or "none" for unknown. */
  ruleId: string;
}

function signalHolds(signal: ContextSignal, c: FailureContext): boolean {
  switch (signal) {
    case "session_error":
      return c.sameSessionErrors > 0;
    case "gateway_degraded":
      return c.gatewaySuccessRate !== null && c.gatewayVolume >= DEGRADED_MIN_VOLUME && c.gatewaySuccessRate < DEGRADED_RATE;
    case "slow_failure":
      return c.secondsToFail !== null && c.secondsToFail >= SLOW_FAILURE_SECONDS;
  }
}

function ruleMatches(rule: FailureRule, input: FailureInput): boolean {
  if (rule.gateway && rule.gateway !== input.gateway) return false;
  if (rule.method && rule.method !== input.method) return false;
  if (rule.codeIncludes) {
    const code = input.code.toLowerCase();
    if (!rule.codeIncludes.some((token) => code.includes(token))) return false;
  }
  if (rule.signals && !rule.signals.every((s) => signalHolds(s, input.context))) return false;
  // A rule with neither a code list nor a signal list would match everything; refuse it rather than guess.
  return Boolean(rule.codeIncludes || rule.signals);
}

/** Code rules in table order, then context rules in table order, else unknown. */
export function classifyFailure(input: FailureInput, rules: readonly FailureRule[] = DEFAULT_RULES): Classification {
  for (const rule of rules) if (rule.codeIncludes && ruleMatches(rule, input)) return { category: rule.category, ruleId: rule.id };
  for (const rule of rules) if (!rule.codeIncludes && rule.signals && ruleMatches(rule, input)) return { category: rule.category, ruleId: rule.id };
  return { category: "unknown", ruleId: "none" };
}

/** Which signals held for a failure, for display ("3 of these also saw an error in the same session"). */
export function activeSignals(context: FailureContext): ContextSignal[] {
  return (["session_error", "gateway_degraded", "slow_failure"] as const).filter((s) => signalHolds(s, context));
}

/** A short stable version string for a rule set, stored with each classification so old rows can be told from new. */
export function rulesVersion(rules: readonly FailureRule[]): string {
  let h = 5381;
  const text = JSON.stringify(rules);
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `r${(h >>> 0).toString(36)}`;
}

/**
 * Reads a rule table from JSON (a deployment's own file). Returns the rules, or the reasons it was refused: an unknown category, a
 * rule with neither code tokens nor signals, a duplicate id, a signal that does not exist. A bad file must never silently turn
 * every failure into "unknown".
 */
export function parseRules(json: unknown): { ok: true; rules: FailureRule[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(json)) return { ok: false, errors: ["The rule table must be a list"] };
  const ids = new Set<string>();
  const rules: FailureRule[] = [];
  const SIGNALS = ["session_error", "gateway_degraded", "slow_failure"];
  json.forEach((raw, i) => {
    const r = raw as Record<string, unknown>;
    const where = `rule ${i + 1}`;
    if (typeof r?.id !== "string" || !r.id) return void errors.push(`${where}: id is required`);
    if (ids.has(r.id)) errors.push(`${where}: duplicate id "${r.id}"`);
    ids.add(r.id);
    if (!(FAILURE_CATEGORIES as readonly string[]).includes(String(r.category))) errors.push(`${where} (${r.id}): unknown category "${String(r.category)}"`);
    const codes = r.codeIncludes;
    const signals = r.signals;
    if (codes !== undefined && (!Array.isArray(codes) || codes.length === 0 || !codes.every((c) => typeof c === "string" && c.length > 0))) errors.push(`${where} (${r.id}): codeIncludes must be a non-empty list of text`);
    if (signals !== undefined && (!Array.isArray(signals) || signals.length === 0 || !signals.every((s) => SIGNALS.includes(String(s))))) errors.push(`${where} (${r.id}): signals must be a non-empty list of ${SIGNALS.join(", ")}`);
    if (codes === undefined && signals === undefined) errors.push(`${where} (${r.id}): needs codeIncludes or signals`);
    rules.push({
      id: r.id,
      category: r.category as FailureCategory,
      ...(typeof r.gateway === "string" ? { gateway: r.gateway } : {}),
      ...(typeof r.method === "string" ? { method: r.method } : {}),
      ...(Array.isArray(codes) ? { codeIncludes: (codes as string[]).map((c) => c.toLowerCase()) } : {}),
      ...(Array.isArray(signals) ? { signals: signals as ContextSignal[] } : {}),
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules };
}

/** What each category means and what to do about it. Shown in the dashboard; kept beside the rules so they change together. */
export const CATEGORY_GUIDE: Record<FailureCategory, { label: string; meaning: string; action: string; fixable: "you" | "gateway" | "customer" | "unknown" }> = {
  insufficient_funds: { label: "Insufficient funds", meaning: "The customer's account did not have enough balance.", action: "Offer another payment method on the retry, and keep the cart so they can come back.", fixable: "customer" },
  bank_decline: { label: "Bank declined", meaning: "The customer's bank or card issuer refused the payment.", action: "Prompt for a different card or method. If one bank dominates, tell the gateway: it may be a routing issue.", fixable: "customer" },
  auth_failed: { label: "Authentication failed", meaning: "The 3D Secure, OTP or PIN step failed.", action: "Check the authentication step in your checkout. A rate far higher in one browser points to a bug there. Offer UPI or netbanking as a fallback.", fixable: "you" },
  upi_timeout: { label: "UPI timed out", meaning: "The UPI app did not respond in time.", action: "Use UPI intent (open the app) instead of collect requests, and tell customers to approve quickly.", fixable: "you" },
  upi_pending_expired: { label: "UPI request expired", meaning: "The customer did not approve the UPI collect request before it expired.", action: "Shorten the path to approval, remind the customer in the page, and prefer intent over collect.", fixable: "you" },
  gateway_outage: { label: "Gateway problem", meaning: "The payment gateway failed or was degraded at the time.", action: "Check the gateway's status and Gateway Health. If it keeps happening, add a second gateway as a fallback.", fixable: "gateway" },
  network_error: { label: "Network error", meaning: "The connection dropped or the attempt took too long.", action: "Make the checkout retry safely and show a clear message. Check how the page handles a lost connection.", fixable: "you" },
  app_bug: { label: "Your app errored", meaning: "The browser reported an error in the same session shortly before the payment failed.", action: "Fix first: open the linked errors. A bug in checkout costs money on every visit.", fixable: "you" },
  user_abandon: { label: "Customer left", meaning: "The customer closed or cancelled the payment.", action: "Not a fault to fix. Reduce friction earlier in checkout, and consider a reminder.", fixable: "customer" },
  fraud_block: { label: "Blocked for risk", meaning: "A fraud or risk rule stopped the payment.", action: "Review your gateway's risk rules. Genuine customers blocked here are lost sales.", fixable: "gateway" },
  unknown: { label: "Not explained yet", meaning: "No rule matched this failure code.", action: "Look at the top raw codes below and add a rule for them.", fixable: "unknown" },
};
