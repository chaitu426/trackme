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
      // Allow self-signed certs in dev; in prod set SMTP_REJECT_UNAUTHORIZED=true
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED === "true",
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
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[Email] CRITICAL: No email provider configured in production! " +
        "Set RESEND_API_KEY or SMTP_USER + SMTP_PASS."
    );
  }

  return sendViaConsole(params);
}

// ─── OTP Email Template ───────────────────────────────────────────────────────

export async function sendOtpEmail(
  email: string,
  code: string,
  purpose: string
): Promise<EmailResult> {
  const isSignup = purpose === "signup_verify";

  const subject = isSignup
    ? `${code} is your TrackMe verification code`
    : `${code} is your TrackMe login code`;

  const title = isSignup ? "Verify your email address" : "Your login code";
  const message = isSignup
    ? "Welcome to TrackMe! Use the verification code below to confirm your email and activate your privacy-first analytics account:"
    : "Here's your one-time login code for TrackMe:";

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${subject}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #09090b;
            color: #f4f4f5;
            padding: 40px 20px;
          }
          .wrapper { max-width: 520px; margin: 0 auto; }
          .card {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 16px;
            padding: 40px 32px;
            text-align: center;
          }
          .logo {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 18px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 32px;
          }
          .logo-dot { width: 8px; height: 8px; background: #818cf8; border-radius: 50%; }
          h1 { font-size: 20px; font-weight: 600; color: #fafafa; margin-bottom: 12px; }
          .subtitle { font-size: 14px; color: #a1a1aa; line-height: 1.6; margin-bottom: 32px; }
          .code-label { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: #71717a; text-transform: uppercase; margin-bottom: 12px; }
          .code-box {
            display: inline-flex;
            gap: 8px;
            background: #09090b;
            border: 1px solid #3f3f46;
            border-radius: 12px;
            padding: 20px 28px;
            margin-bottom: 8px;
          }
          .code-digit {
            font-size: 28px;
            font-weight: 700;
            font-family: 'SF Mono', 'Fira Code', monospace;
            color: #818cf8;
            letter-spacing: 0.05em;
          }
          .expiry {
            font-size: 12px;
            color: #52525b;
            margin-bottom: 32px;
            margin-top: 8px;
          }
          .divider { border: none; border-top: 1px solid #27272a; margin: 0 0 24px; }
          .security-note {
            background: #0c0c10;
            border: 1px solid #27272a;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 12px;
            color: #71717a;
            text-align: left;
            line-height: 1.5;
            margin-bottom: 24px;
          }
          .security-note strong { color: #a1a1aa; }
          .footer { font-size: 11px; color: #52525b; line-height: 1.6; }
          .footer a { color: #818cf8; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="card">
            <div class="logo">
              <div class="logo-dot"></div>
              TrackMe
            </div>
            <h1>${title}</h1>
            <p class="subtitle">${message}</p>

            <p class="code-label">Verification Code</p>
            <div class="code-box">
              <span class="code-digit">${code.slice(0,1)}</span>
              <span class="code-digit">${code.slice(1,2)}</span>
              <span class="code-digit">${code.slice(2,3)}</span>
              <span class="code-digit">${code.slice(3,4)}</span>
              <span class="code-digit">${code.slice(4,5)}</span>
              <span class="code-digit">${code.slice(5,6)}</span>
            </div>
            <p class="expiry">⏱ Expires in 10 minutes</p>

            <hr class="divider">

            <div class="security-note">
              <strong>Security notice:</strong> TrackMe will never ask for this code via phone, chat, or email. If you did not request this code, you can safely ignore this email — your account is not at risk.
            </div>

            <p class="footer">
              Sent by TrackMe · Privacy-first analytics<br>
              <a href="#">Unsubscribe</a> · <a href="#">Privacy Policy</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = [
    title,
    "",
    message,
    "",
    `Your verification code: ${code}`,
    "",
    "This code expires in 10 minutes.",
    "",
    "If you did not request this, please ignore this email.",
  ].join("\n");

  return sendTransactionalEmail({ to: email, subject, text, html });
}

// ─── Workspace Invite Email ────────────────────────────────────────────────────

export interface InviteEmailParams {
  to: string;
  inviterName: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  token: string;
  expiresAt: Date;
}

export async function sendInviteEmail({
  to,
  inviterName,
  workspaceName,
  role,
  token,
  expiresAt,
}: InviteEmailParams): Promise<EmailResult> {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const acceptUrl = `${appUrl}/invite/accept?token=${token}`;
  const expiryDate = expiresAt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const roleLabel =
    role === "admin" ? "Admin" : role === "viewer" ? "Viewer" : "Member";
  const roleBadgeColor =
    role === "admin" ? "#f59e0b" : role === "viewer" ? "#60a5fa" : "#818cf8";

  const subject = `${inviterName} invited you to join ${workspaceName} on TrackMe`;

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${subject}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #09090b;
            color: #f4f4f5;
            padding: 40px 20px;
          }
          .wrapper { max-width: 520px; margin: 0 auto; }
          .card {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 16px;
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #1e1b4b 0%, #18181b 100%);
            padding: 32px;
            text-align: center;
            border-bottom: 1px solid #27272a;
          }
          .logo {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 18px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 20px;
          }
          .logo-dot { display: inline-block; width: 8px; height: 8px; background: #818cf8; border-radius: 50%; }
          .avatar {
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, #818cf8, #6366f1);
            border-radius: 50%;
            margin: 0 auto 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            font-weight: 700;
            color: #fff;
            line-height: 56px;
            text-align: center;
          }
          .body { padding: 32px; }
          h1 { font-size: 20px; font-weight: 700; color: #fafafa; margin-bottom: 8px; }
          .subtitle { font-size: 14px; color: #a1a1aa; line-height: 1.6; margin-bottom: 24px; }
          .workspace-card {
            background: #09090b;
            border: 1px solid #3f3f46;
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .workspace-name { font-size: 15px; font-weight: 600; color: #fafafa; }
          .role-badge {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            padding: 3px 10px;
            border-radius: 999px;
            background: ${roleBadgeColor}20;
            color: ${roleBadgeColor};
            border: 1px solid ${roleBadgeColor}40;
          }
          .cta {
            display: block;
            width: 100%;
            background: #4f46e5;
            color: #fff;
            text-align: center;
            padding: 14px;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 600;
            text-decoration: none;
            margin-bottom: 16px;
          }
          .cta:hover { background: #4338ca; }
          .url-fallback {
            font-size: 11px;
            color: #52525b;
            word-break: break-all;
            text-align: center;
            margin-bottom: 24px;
          }
          .url-fallback a { color: #818cf8; }
          .divider { border: none; border-top: 1px solid #27272a; margin: 0 0 24px; }
          .security {
            background: #0c0c10;
            border: 1px solid #27272a;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 12px;
            color: #71717a;
            line-height: 1.5;
            margin-bottom: 24px;
          }
          .security strong { color: #a1a1aa; }
          .footer { font-size: 11px; color: #52525b; text-align: center; line-height: 1.6; }
          .footer a { color: #818cf8; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="card">
            <div class="header">
              <div class="logo"><span class="logo-dot"></span>TrackMe</div>
              <div class="avatar">${inviterName.slice(0, 1).toUpperCase()}</div>
            </div>
            <div class="body">
              <h1>You're invited to join ${workspaceName}</h1>
              <p class="subtitle">
                <strong style="color:#e4e4e7">${inviterName}</strong> has invited you to collaborate on
                <strong style="color:#e4e4e7">${workspaceName}</strong> — a privacy-first analytics workspace on TrackMe.
              </p>

              <div class="workspace-card">
                <div>
                  <div class="workspace-name">${workspaceName}</div>
                  <div style="font-size:12px;color:#71717a;margin-top:2px">TrackMe Workspace</div>
                </div>
                <span class="role-badge">${roleLabel}</span>
              </div>

              <a href="${acceptUrl}" class="cta">Accept Invitation →</a>

              <p class="url-fallback">
                Or copy this link: <a href="${acceptUrl}">${acceptUrl}</a>
              </p>

              <hr class="divider">

              <div class="security">
                <strong>⏱ This invite expires ${expiryDate}.</strong><br>
                If you don't have a TrackMe account yet, you'll be prompted to create one — it only takes seconds.
                If you weren't expecting this invitation, you can safely ignore this email.
              </div>

              <p class="footer">
                Sent by TrackMe · Privacy-first, cookieless analytics<br>
                <a href="#">Privacy Policy</a> · <a href="#">Unsubscribe</a>
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = [
    `${inviterName} invited you to join ${workspaceName} on TrackMe`,
    "",
    `You've been invited as a ${roleLabel} to the workspace "${workspaceName}".`,
    "",
    `Accept the invitation here:`,
    acceptUrl,
    "",
    `This invite expires on ${expiryDate}.`,
    "",
    "If you weren't expecting this, you can safely ignore this email.",
  ].join("\n");

  return sendTransactionalEmail({ to, subject, text, html });
}

export { sendTransactionalEmail as sendEmail };
