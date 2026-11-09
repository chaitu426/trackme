import type { ErrorPayload } from "./events.js";

/**
 * PII scrubbing for error reports. The SDK runs it before sending and the worker runs it again before
 * storing, so a modified or older client cannot put secrets into the warehouse.
 *
 * It removes things that should never be stored (card numbers, auth tokens, passwords, API keys, emails,
 * phone numbers, UPI ids) and keeps the rest of the text readable. It is idempotent: scrubbing scrubbed
 * text changes nothing. Patterns err on the side of removing; a version string like 1.2.3.4 or a
 * timestamp must survive, which is why phone numbers need a leading + or a recognisable shape.
 */

const RULES: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
  // Credentials first, so an email or number inside one is not half-matched by a later rule.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[jwt]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer [token]"],
  [/\bBasic\s+[A-Za-z0-9+/]{8,}=*/g, "Basic [token]"],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[api-key]"],
  [/\bgip_live_[A-Za-z0-9_-]{8,}/g, "[api-key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[api-key]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[api-key]"],
  [
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]{3,}/gi,
    (_m, key, sep) => `${key}${sep}[redacted]`,
  ],
  // Payment identifiers.
  [/\b[\w.-]{2,}@(?:ok(?:sbi|hdfcbank|icici|axis)|ybl|ibl|axl|paytm|upi|apl|sbi|hdfcbank|icici|axisbank|barodampay)\b/gi, "[upi-id]"],
  [/(?<![\w.])\+\d[\d\s().-]{7,17}\d(?![\w])/g, "[phone]"],
  [/(?<!\d)[6-9]\d{9}(?!\d)/g, "[phone]"],
  [/(?<!\d)\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g, "[phone]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
];

/** A run of 13 or more digits, possibly grouped with single spaces or dashes. */
const CARD_RUN = /\d(?:[ -]?\d){12,}/g;

/** Luhn check, so a long order number is not mistaken for a card. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Replaces card numbers inside a run of digits. A run with spaces or dashes may have other digits glued to it
 * ("4242 4242 4242 4242 500"), so every 13 to 19 digit window is tried and the first that passes Luhn goes.
 * An unbroken run is only a card if the whole run is 13 to 19 digits: a longer one is an id, not a card.
 */
function redactCards(text: string): string {
  return text.replace(CARD_RUN, (run) => {
    const digits: string[] = [];
    const at: number[] = [];
    for (let i = 0; i < run.length; i += 1) {
      if (run[i]! >= "0" && run[i]! <= "9") {
        digits.push(run[i]!);
        at.push(i);
      }
    }
    if (digits.length === run.length) {
      return digits.length <= 19 && luhn(digits.join("")) ? "[card]" : run;
    }
    let out = "";
    let copied = 0;
    for (let i = 0; i + 13 <= digits.length; ) {
      let hit = 0;
      for (let len = Math.min(19, digits.length - i); len >= 13; len -= 1) {
        if (luhn(digits.slice(i, i + len).join(""))) {
          hit = len;
          break;
        }
      }
      if (hit === 0) {
        i += 1;
        continue;
      }
      out += run.slice(copied, at[i]) + "[card]";
      copied = at[i + hit - 1]! + 1;
      i += hit;
    }
    return out + run.slice(copied);
  });
}

export function scrubText(input: string): string {
  let out = redactCards(input);
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement as never);
  }
  return out;
}

/** Query parameters that survive in URLs. Everything else keeps its name but loses its value. */
export const QUERY_ALLOWLIST: ReadonlySet<string> = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "page",
  "sort",
  "lang",
]);

/** Drops credentials, the fragment, and every query value not on the allowlist. */
export function scrubUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.hash = "";
    const kept = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      kept.append(key, QUERY_ALLOWLIST.has(key.toLowerCase()) ? scrubText(value) : "[redacted]");
    }
    url.search = kept.toString().replace(/%5Bredacted%5D/g, "[redacted]");
    return scrubText(url.toString());
  } catch {
    // Not an absolute URL (a relative path in a stack frame or breadcrumb): cut the query and fragment.
    return scrubText(input.split("#")[0]!.split("?")[0]!);
  }
}

/** URLs inside free text (a message or a breadcrumb), each reduced with scrubUrl. */
function scrubUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>)]+/g, (url) => scrubUrl(url));
}

const clean = (text: string) => scrubText(scrubUrlsInText(text));

/** A scrubbed copy of an error payload: message, frame files, breadcrumbs and tag values. */
export function scrubErrorPayload(error: ErrorPayload): ErrorPayload {
  return {
    ...error,
    message: clean(error.message),
    ...(error.frames
      ? { frames: error.frames.map((frame) => ({ ...frame, file: scrubUrl(frame.file) })) }
      : {}),
    ...(error.breadcrumbs
      ? { breadcrumbs: error.breadcrumbs.map((crumb) => ({ ...crumb, m: clean(crumb.m) })) }
      : {}),
    ...(error.tags
      ? { tags: Object.fromEntries(Object.entries(error.tags).map(([key, value]) => [key, clean(value)])) }
      : {}),
  };
}
