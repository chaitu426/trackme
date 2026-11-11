/**
 * TrackMe Transactional Email Service
 *
 * Modular, production-grade email dispatcher with provider priority:
 *
 *  Priority 1 → Resend API         (RESEND_API_KEY)
 *  Priority 2 → SMTP / Gmail       (SMTP_HOST + SMTP_USER + SMTP_PASS)
 *  Priority 3 → Console Logger     (dev fallback — never in production)
 *
 * To switch providers: just set/unset the relevant env vars.
 * Provider selection is automatic at runtime — no code changes needed.
 */

import nodemailer from "nodemailer";
import { codeBoxes, escapeHtml, factsTable, oneLine, renderEmail, safeUrl } from "./email-layout";

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailResult {
  success: boolean;
  provider: "resend" | "smtp" | "console";
  id?: string;
  error?: string;
}

// ─── Provider: Resend ────────────────────────────────────────────────────────

async function sendViaResend(
  params: SendEmailParams,
  apiKey: string,
  from: string
): Promise<EmailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return { success: true, provider: "resend", id: data.id };
}

// ─── Provider: SMTP (Gmail / Outlook / Custom) ───────────────────────────────

async function sendViaSmtp(
  params: SendEmailParams,
  from: string
): Promise<EmailResult> {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === "true"; // true = TLS/465, false = STARTTLS/587

  const smtpConfig: Parameters<typeof nodemailer.createTransport>[0] = {
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    // Gmail STARTTLS on port 587 requires explicit upgrade
    requireTLS: !secure && port === 587,
    tls: {
      // Verify the server certificate by default; set SMTP_REJECT_UNAUTHORIZED=false only for a self-signed dev server
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
      minVersion: "TLSv1.2",
    },
    // Connection timeout (ms)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };

  const transporter = nodemailer.createTransport(smtpConfig);

  // Verify connection before sending
  await transporter.verify();

  const info = await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });

  return { success: true, provider: "smtp", id: info.messageId };
}


// ─── Provider: Console (dev-only fallback) ───────────────────────────────────

function sendViaConsole(params: SendEmailParams): EmailResult {
  const line = "─".repeat(60);
  console.log(`
╭${line}╮
│ 📧  TRACKME EMAIL — DEV CONSOLE FALLBACK                   │
├${line}┤
│  TO:      ${params.to.slice(0, 48).padEnd(48)} │
│  SUBJECT: ${params.subject.slice(0, 48).padEnd(48)} │
├${line}┤
│  ${params.text.slice(0, 58).padEnd(58)} │
╰${line}╯

⚠️  Email not actually sent. Configure RESEND_API_KEY or SMTP_* env vars.
`);
  return { success: true, provider: "console" };
}

// ─── Main Dispatcher ─────────────────────────────────────────────────────────

export async function sendTransactionalEmail(
  params: SendEmailParams
): Promise<EmailResult> {
  const from = process.env.EMAIL_FROM || "TrackMe <noreply@trackme.app>";
  const resendKey = process.env.RESEND_API_KEY;
  const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;

  // ── 1. Try Resend ──────────────────────────────────────────────────────────
  if (resendKey) {
    try {
      const result = await sendViaResend(params, resendKey, from);
      console.log(`[Email:Resend] Sent to ${params.to} (id: ${result.id})`);
      return result;
    } catch (err) {
      console.warn("[Email:Resend] Failed, falling back to SMTP:", err);
    }
  }

  // ── 2. Try SMTP ────────────────────────────────────────────────────────────
  if (smtpConfigured) {
    try {
      const result = await sendViaSmtp(params, from);
      console.log(`[Email:SMTP] Sent to ${params.to} via ${process.env.SMTP_HOST || "smtp.gmail.com"} (id: ${result.id})`);
      return result;
    } catch (err) {
      console.warn("[Email:SMTP] Failed, falling back to console logger:", err);
    }
  }

  // ── 3. Dev console logger ──────────────────────────────────────────────────
  // The console fallback prints the whole message, which carries one-time codes and invite links. It exists
  // for local development only. In production a missing or failing provider is an error the caller must see:
  // nothing is printed, and nobody is told that a message was sent when it was not.
  if (process.env.NODE_ENV === "production") {
    console.error("[Email] No working email provider in production. Set RESEND_API_KEY or SMTP_USER + SMTP_PASS.");
    throw new Error("Email delivery is not available");
  }

  return sendViaConsole(params);
}

// ─── Templates ────────────────────────────────────────────────────────────────
//
// Every message is built with `renderEmail` (email-layout.ts): the same palette, mark and glyph band as the app. Text that comes
// from a person (workspace and inviter names, alert titles and fields) is escaped at the point it enters the HTML, and a
// plain-text copy is always sent beside the HTML one.

export { escapeHtml, oneLine } from "./email-layout";

const appBase = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export async function sendOtpEmail(email: string, code: string, purpose: string): Promise<EmailResult> {
  const isSignup = purpose === "signup_verify";
  const subject = isSignup ? `${code} is your TrackMe verification code` : `${code} is your TrackMe sign-in code`;
  const title = isSignup ? "Verify your email address" : "Your sign-in code";
  const intro = isSignup
    ? "Welcome to TrackMe. Enter this code to confirm your email address and finish creating your account."
    : "Enter this code to finish signing in to TrackMe.";

  const html = renderEmail({
    picture: "gauge",
    preheader: `${code} is your code. It expires in 10 minutes.`,
    title,
    intro: escapeHtml(intro),
    body: `${codeBoxes(code)}<p style="margin:14px 0 0;text-align:center;font:400 13px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;color:#85858b;">It expires in 10 minutes and works once.</p>`,
    note: {
      tone: "info",
      html: "<strong style=\"color:#ededed;font-weight:500;\">TrackMe will never ask you for this code</strong> by phone, chat or email. If you did not ask for it, ignore this message: nothing has changed on your account.",
    },
    reason: escapeHtml(`Sent to ${oneLine(email, 120)} because someone entered this address on the TrackMe ${isSignup ? "sign-up" : "sign-in"} page.`),
    appUrl: appBase(),
  });

  const text = [
    title,
    "",
    intro,
    "",
    `Your code: ${code}`,
    "It expires in 10 minutes and works once.",
    "",
    "TrackMe will never ask you for this code by phone, chat or email. If you did not ask for it, ignore this message: nothing has changed on your account.",
  ].join("\n");

  return sendTransactionalEmail({ to: email, subject, text, html });
}

export interface InviteEmailParams {
  to: string;
  inviterName: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  token: string;
  expiresAt: Date;
}

export async function sendInviteEmail({ to, inviterName, workspaceName, role, token, expiresAt }: InviteEmailParams): Promise<EmailResult> {
  const acceptUrl = `${appBase()}/invite/accept?token=${encodeURIComponent(token)}`;
  const expiryDate = expiresAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const roleLabel = role === "admin" ? "Admin" : role === "viewer" ? "Viewer" : "Member";

  // Workspace and inviter names are chosen by users and can say anything. The text copies are single-line (the subject and the
  // plain-text body); the HTML copies are escaped, so a name cannot add links, markup or headers.
  const inviterText = oneLine(inviterName);
  const workspaceText = oneLine(workspaceName);
  const subject = `${inviterText} invited you to ${workspaceText} on TrackMe`;

  const html = renderEmail({
    picture: "steps",
    preheader: `${inviterText} invited you to join ${workspaceText} as ${roleLabel}.`,
    title: `Join ${workspaceText} on TrackMe`,
    intro: `<strong style="color:#ededed;font-weight:500;">${escapeHtml(inviterText)}</strong> invited you to a TrackMe workspace to look at its analytics together.`,
    body: factsTable([
      ["Workspace", workspaceText],
      ["Your role", roleLabel],
      ["Invited by", inviterText],
      ["Expires", `${expiryDate} (UTC)`],
    ]),
    action: { label: "Accept invitation", url: acceptUrl },
    note: {
      tone: "info",
      html: "No TrackMe account yet? You will be asked to create one first. If you were not expecting this invitation, ignore this message: nothing happens until you accept.",
    },
    reason: escapeHtml(`Sent to ${oneLine(to, 120)} because ${inviterText} invited this address.`),
    appUrl: appBase(),
  });

  const text = [
    `${inviterText} invited you to ${workspaceText} on TrackMe`,
    "",
    `Role: ${roleLabel}`,
    `Accept the invitation: ${acceptUrl}`,
    `This invitation expires on ${expiryDate} (UTC).`,
    "",
    "No TrackMe account yet? You will be asked to create one first. If you were not expecting this, ignore this message.",
  ].join("\n");

  return sendTransactionalEmail({ to, subject, text, html });
}

export { sendTransactionalEmail as sendEmail };

/**
 * Sent instead of a verification code when someone starts a sign-up with an address that already has an account. The sign-up page
 * answers exactly as it does for a new address, so this email is the only place the difference shows, and only the mailbox owner sees it.
 */
export async function sendAccountExistsEmail(to: string): Promise<EmailResult> {
  const loginUrl = `${appBase()}/login`;
  const subject = "You already have a TrackMe account";
  const html = renderEmail({
    picture: "ridge",
    preheader: "Someone tried to sign up with this address. Sign in instead.",
    title: "You already have an account",
    intro: "Someone tried to create a TrackMe account with this email address, but one already exists. You can sign in with it.",
    action: { label: "Sign in", url: loginUrl },
    note: { tone: "info", html: "If this was not you, ignore this message: nothing was changed." },
    reason: escapeHtml(`Sent to ${oneLine(to, 120)} because this address was entered on the TrackMe sign-up page.`),
    appUrl: appBase(),
  });
  const text = [
    "You already have a TrackMe account",
    "",
    "Someone tried to create a TrackMe account with this email address, but one already exists.",
    `Sign in: ${loginUrl}`,
    "",
    "If this was not you, ignore this message: nothing was changed.",
  ].join("\n");
  return sendTransactionalEmail({ to, subject, text, html });
}

export interface AlertEmailInput {
  title: string;
  message: string;
  timestamp: string;
  siteDomain: string;
  workspaceName: string;
  fields?: Record<string, string | number>;
  dashboardUrl?: string;
  /** `bad` for something broken, `warn` for something drifting. Defaults to warn. */
  severity?: "warn" | "bad" | "good";
}

/** An alert, built the same way as every other message, with every user-supplied string escaped. */
export function renderAlertEmail(a: AlertEmailInput): { subject: string; text: string; html: string } {
  const title = oneLine(a.title, 140);
  const when = new Date(a.timestamp);
  const whenText = Number.isNaN(when.getTime()) ? oneLine(a.timestamp, 40) : when.toUTCString();
  const facts: Array<[string, string | number]> = [
    ["Site", oneLine(a.siteDomain, 120)],
    ["Workspace", oneLine(a.workspaceName, 120)],
    ["When", whenText],
    ...Object.entries(a.fields ?? {}).map(([k, v]): [string, string | number] => [oneLine(k, 60), typeof v === "number" ? v : oneLine(String(v), 200)]),
  ];
  const dashboard = safeUrl(a.dashboardUrl);
  const html = renderEmail({
    picture: "pulse",
    preheader: oneLine(a.message, 120),
    title,
    intro: escapeHtml(a.message.slice(0, 1_000)),
    body: factsTable(facts),
    ...(dashboard ? { action: { label: "Open in TrackMe", url: dashboard } } : {}),
    note: { tone: a.severity ?? "warn", html: "You are getting this because an alert channel in this workspace includes your address." },
    appUrl: appBase(),
  });
  const text = [
    title,
    "",
    a.message,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(dashboard ? ["", `Open in TrackMe: ${dashboard}`] : []),
  ].join("\n");
  return { subject: `[TrackMe] ${title}`, text, html };
}
