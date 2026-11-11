import { PALETTE } from "@trackme/landing/src/palette";

/**
 * The one layout every TrackMe email uses, built from the product's own palette (Graphite and Signal) and its picture language
 * (the glyph ramp `. : + #`), so a message from us looks like the app it came from.
 *
 * Email clients are a hostile place for CSS, so this is deliberately plain: nested tables, inline styles, system fonts after
 * Geist (which almost no client has), no images (nothing to block, nothing to host), no gradients. The mark and the band are text.
 * Colours come only from PALETTE; `email.test.ts` fails if a template uses any other hex.
 */

const { surface, text, signal } = PALETTE;

/** Escapes text for use inside HTML element content or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Control characters plus the Unicode line and paragraph separators, built from char codes so the source holds no invisible characters.
const LINE_BREAKS = new RegExp(`[\x00-\x1f\x7f${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, "g");

/** One line, bounded: for subject lines and names, where a line break would inject mail headers. */
export function oneLine(value: string, max = 80): string {
  return value.replace(LINE_BREAKS, " ").trim().slice(0, max);
}

/** Only an http(s) URL may become a link or a button; anything else (javascript:, data:) is dropped. */
export function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const SANS = `Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const MONO = `'Geist Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;

/** The colour of `fg` laid over `bg` at `alpha`, as hex: email clients do not all honour rgba, so opacity is pre-blended. */
function blend(fg: string, bg: string, alpha: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [f, b] = [p(fg), p(bg)];
  return "#" + f.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

const RAMP = [".", ":", "+", "#"];

/** The logo: a light tile holding a 3 by 3 wave of the ramp, one frozen frame of the animated mark. */
function mark(): string {
  const cells = [0, 1, 2, 1, 2, 3, 2, 3, 2];
  const rows = [0, 1, 2]
    .map((r) => {
      const tds = [0, 1, 2]
        .map((c) => {
          const level = cells[r * 3 + c]!;
          const color = blend(surface.page, text.strong, 0.35 + level * 0.22);
          return `<td align="center" style="width:7px;height:8px;font:600 9px/8px ${MONO};color:${color};padding:0;">${RAMP[level]}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${text.strong};border-radius:6px;"><tr><td style="padding:3px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`;
}

export type EmailPicture = "gauge" | "steps" | "pulse" | "ridge";

const COLS = 44;
const ROWS = 7;

/**
 * How strongly a cell is "lit", 0 to 1, for each picture. These are the shapes the app's page headers use: a gauge for codes and
 * checks, steps for a funnel (an invitation is a step up), a pulse for activity and alerts, a ridge for traffic.
 */
function lit(kind: EmailPicture, x: number, y: number): number {
  const mid = (ROWS - 1) / 2;
  const u = x / (COLS - 1);
  if (kind === "gauge") {
    // A half dial in real pixels (a glyph is about 7 wide and 12 tall), so the arc is round, with a needle at about two o'clock.
    const px = (x - (COLS - 1) / 2) * 7.2;
    const py = (ROWS - 1 - y) * 12;
    const radius = 72;
    const ring = Math.abs(Math.hypot(px, py) - radius) / 12;
    const angle = Math.atan2(py, px);
    const needle = Math.abs(angle - 0.62) < 0.07 && Math.hypot(px, py) < radius - 14 ? 1 : 0;
    return Math.max(needle, 1 - ring * 0.9);
  }
  if (kind === "steps") {
    const top = ROWS - 1 - Math.floor(u * 5.99) * 1.1;
    return y >= top ? Math.max(0.25, 1 - (y - top) * 0.28) : 0;
  }
  if (kind === "pulse") {
    const d = u - 0.5;
    const spike = Math.exp(-Math.pow(d / 0.045, 2)) * 3 - Math.exp(-Math.pow((d - 0.07) / 0.04, 2)) * 1.6;
    const line = mid - spike + Math.sin(u * 30) * 0.15;
    return Math.max(0, 1 - Math.abs(y - line) * 0.75);
  }
  const h = 0.45 + 0.28 * Math.sin(u * 7.1) + 0.17 * Math.sin(u * 15.3 + 1.4) + 0.1 * Math.sin(u * 31 + 0.5);
  const top = ROWS - 1 - h * (ROWS - 1);
  return y >= top ? Math.max(0.2, 1 - (y - top) * 0.3) : 0;
}

/** A picture drawn in the ramp, as text: no image to block, no file to host. Consecutive cells of one level share a span. */
function picture(kind: EmailPicture, background: string): string {
  const faint = blend(text.strong, background, 0.1);
  const rows: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    let html = "";
    let run = "";
    let runColor = "";
    const flush = () => {
      if (run) html += `<span style="color:${runColor};">${run}</span>`;
      run = "";
    };
    for (let x = 0; x < COLS; x++) {
      const v = lit(kind, x, y);
      const level = v > 0.78 ? 3 : v > 0.5 ? 2 : v > 0.22 ? 1 : 0;
      const color = level === 0 ? faint : blend(text.strong, background, 0.2 + level * 0.27);
      const ch = v <= 0.05 ? "." : RAMP[level]!;
      if (color !== runColor) {
        flush();
        runColor = color;
      }
      run += ch === "." ? "." : ch;
    }
    flush();
    rows.push(html);
  }
  return `<div style="font:500 12px/12px ${MONO};white-space:pre;overflow:hidden;text-align:center;letter-spacing:0;">${rows.join("<br>")}</div>`;
}

export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailNote {
  /** `warn` carries the warning signal; `info` is neutral. Signal colour means something here exactly as it does in the app. */
  tone: "info" | "warn" | "bad" | "good";
  /** Already escaped HTML. */
  html: string;
}

export interface EmailParts {
  /** The matrix picture across the top of the card. */
  picture?: EmailPicture;
  /** The grey line a mail client shows after the subject. Plain text. */
  preheader: string;
  /** Sentence case, plain text. */
  title: string;
  /** Already escaped HTML: the paragraph under the title. */
  intro?: string;
  /** Already escaped HTML placed between the intro and the button (a code, a table). */
  body?: string;
  action?: EmailAction;
  note?: EmailNote;
  /** Already escaped HTML for the footer's context line ("You received this because …"). */
  reason?: string;
  appUrl: string;
}

const NOTE_EDGE: Record<EmailNote["tone"], string> = { info: text.faint, warn: signal.warn, bad: signal.bad, good: signal.good };

/** The code, as a row of boxes that stay one line at phone width. Digits only: the caller has already validated the code. */
export function codeBoxes(code: string): string {
  const cells = [...code]
    .map(
      (d) =>
        `<td align="center" style="width:40px;height:52px;background:${surface.raised};border:1px solid ${blend(text.strong, surface.card, 0.12)};border-radius:8px;font:500 26px/52px ${MONO};color:${text.strong};">${escapeHtml(d)}</td>`
    )
    .join(`<td style="width:6px;font-size:0;line-height:0;">&nbsp;</td>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>${cells}</tr></table>`;
}

/** Label and value rows, for an alert's facts or an invite's details. Values are escaped here. */
export function factsTable(rows: Array<[string, string | number]>): string {
  const body = rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 14px;${i > 0 ? `border-top:1px solid ${blend(text.strong, surface.card, 0.08)};` : ""}font:400 13px/1.4 ${SANS};color:${text.muted};width:38%;vertical-align:top;">${escapeHtml(String(k))}</td><td style="padding:10px 14px;${i > 0 ? `border-top:1px solid ${blend(text.strong, surface.card, 0.08)};` : ""}font:500 13px/1.4 ${SANS};color:${text.strong};vertical-align:top;">${escapeHtml(String(v))}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${surface.ink};border:1px solid ${blend(text.strong, surface.card, 0.12)};border-radius:8px;">${body}</table>`;
}

export function renderEmail(p: EmailParts): string {
  const line = blend(text.strong, surface.card, 0.08);
  const action = p.action && safeUrl(p.action.url);
  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr><td style="background:${text.strong};border-radius:8px;"><a href="${escapeHtml(action)}" style="display:inline-block;padding:12px 22px;font:500 14px/1 ${SANS};color:${surface.page};text-decoration:none;">${escapeHtml(p.action!.label)}</a></td></tr></table>
       <p style="margin:14px 0 0;font:400 12px/1.5 ${MONO};color:${text.faint};word-break:break-all;">${escapeHtml(action)}</p>`
    : "";
  const note = p.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr><td style="background:${surface.ink};border:1px solid ${line};border-left:3px solid ${NOTE_EDGE[p.note.tone]};border-radius:8px;padding:12px 14px;font:400 13px/1.55 ${SANS};color:${text.body};">${p.note.html}</td></tr></table>`
    : "";
  const privacy = escapeHtml(`${p.appUrl.replace(/\/$/, "")}/legal/privacy`);

  return `<!DOCTYPE html>
<html lang="en" style="color-scheme:dark;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(p.title)}</title>
</head>
<body style="margin:0;padding:0;background:${surface.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${surface.ink};font-size:1px;line-height:1px;">${escapeHtml(p.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${surface.ink};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;">${mark()}</td>
        <td style="vertical-align:middle;padding-left:10px;font:500 16px/1 ${SANS};color:${text.strong};">TrackMe</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${surface.card};border:1px solid ${line};border-radius:12px;padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:20px 20px 0;">${picture(p.picture ?? "ridge", surface.card)}</td></tr>
        <tr><td style="padding:26px 28px 32px;">
          <h1 style="margin:0;font:500 22px/1.3 ${SANS};color:${text.strong};">${escapeHtml(p.title)}</h1>
          ${p.intro ? `<p style="margin:12px 0 0;font:400 15px/1.6 ${SANS};color:${text.body};">${p.intro}</p>` : ""}
          ${p.body ? `<div style="margin:24px 0 0;">${p.body}</div>` : ""}
          ${button}
          ${note}
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 4px 0;font:400 12px/1.6 ${SANS};color:${text.faint};">
      ${p.reason ? `<p style="margin:0 0 8px;">${p.reason}</p>` : ""}
      <p style="margin:0;">TrackMe &middot; Cookieless analytics &middot; <a href="${privacy}" style="color:${text.muted};text-decoration:underline;">Privacy</a></p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
