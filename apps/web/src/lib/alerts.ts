/**
 * TrackMe Alert Notification Dispatcher
 *
 * Handles delivery of alert notifications to:
 *   - Slack Incoming Webhooks
 *   - Discord Incoming Webhooks
 *   - Email (via existing email.ts service)
 *   - Generic Webhooks (HMAC-signed)
 *
 * Each dispatcher returns { ok: boolean, error?: string }
 */

import crypto from "crypto";
import { sendEmail } from "./email";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChannelType = "slack" | "discord" | "email" | "webhook";

export interface AlertPayload {
  title: string;
  message: string;
  /** ISO timestamp of the event */
  timestamp: string;
  /** Site domain this alert is about */
  siteDomain: string;
  /** Workspace name */
  workspaceName: string;
  /** Alert rule type */
  ruleType: string;
  /** Optional extra fields for rich formatting */
  fields?: Record<string, string | number>;
  /** Dashboard link */
  dashboardUrl?: string;
}

export interface DispatchResult {
  ok: boolean;
  error?: string;
  provider: ChannelType;
}

// ─── Slack ───────────────────────────────────────────────────────────────────

export async function dispatchToSlack(
  webhookUrl: string,
  payload: AlertPayload
): Promise<DispatchResult> {
  try {
    const fields = payload.fields
      ? Object.entries(payload.fields).map(([k, v]) => ({
          type: "mrkdwn",
          text: `*${k}*\n${v}`,
        }))
      : [];

    const body = {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🔔 ${payload.title}`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: payload.message,
          },
        },
        ...(fields.length > 0
          ? [
              {
                type: "section",
                fields: fields.slice(0, 10), // Slack max 10 fields
              },
            ]
          : []),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `*Site:* ${payload.siteDomain} · *Workspace:* ${payload.workspaceName} · ${new Date(payload.timestamp).toLocaleString()}`,
            },
          ],
        },
        ...(payload.dashboardUrl
          ? [
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Open Dashboard", emoji: true },
                    url: payload.dashboardUrl,
                    style: "primary",
                  },
                ],
              },
            ]
          : []),
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Slack responded ${res.status}: ${text}`, provider: "slack" };
    }

    return { ok: true, provider: "slack" };
  } catch (err) {
    return { ok: false, error: String(err), provider: "slack" };
  }
}

// ─── Discord ─────────────────────────────────────────────────────────────────

export async function dispatchToDiscord(
  webhookUrl: string,
  payload: AlertPayload
): Promise<DispatchResult> {
  try {
    const fields = payload.fields
      ? Object.entries(payload.fields).map(([k, v]) => ({
          name: k,
          value: String(v),
          inline: true,
        }))
      : [];

    const body = {
      embeds: [
        {
          title: `🔔 ${payload.title}`,
          description: payload.message,
          color: 0x6c5ce7, // TrackMe purple
          fields,
          footer: {
            text: `${payload.siteDomain} · ${payload.workspaceName}`,
          },
          timestamp: payload.timestamp,
          ...(payload.dashboardUrl ? { url: payload.dashboardUrl } : {}),
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Discord responded ${res.status}: ${text}`, provider: "discord" };
    }

    return { ok: true, provider: "discord" };
  } catch (err) {
    return { ok: false, error: String(err), provider: "discord" };
  }
}

// ─── Email ───────────────────────────────────────────────────────────────────

export async function dispatchToEmail(
  addresses: string[],
  payload: AlertPayload
): Promise<DispatchResult> {
  try {
    const fieldRows = payload.fields
      ? Object.entries(payload.fields)
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px;color:#a1a1aa;font-size:13px;">${k}</td>` +
              `<td style="padding:6px 12px;color:#f4f4f5;font-size:13px;font-weight:600;">${v}</td></tr>`
          )
          .join("")
      : "";

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${payload.title}</title></head>
<body style="background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:40px 0;">
  <div style="max-width:540px;margin:0 auto;background:#18181b;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6c5ce7,#a78bfa);padding:28px 32px;">
      <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;">TrackMe Alert</p>
      <h1 style="margin:8px 0 0;color:#fff;font-size:22px;font-weight:700;">${payload.title}</h1>
    </div>
    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#a1a1aa;font-size:15px;line-height:1.6;">${payload.message}</p>
      ${
        fieldRows
          ? `<table style="width:100%;border-collapse:collapse;background:#09090b;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">${fieldRows}</table>`
          : ""
      }
      ${
        payload.dashboardUrl
          ? `<div style="margin-top:28px;"><a href="${payload.dashboardUrl}" style="display:inline-block;background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Open Dashboard →</a></div>`
          : ""
      }
    </div>
    <!-- Footer -->
    <div style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.06);">
      <p style="margin:0;color:#52525b;font-size:12px;">${payload.siteDomain} · ${payload.workspaceName} · ${new Date(payload.timestamp).toUTCString()}</p>
    </div>
  </div>
</body>
</html>`;

    const text = `${payload.title}\n\n${payload.message}\n\nSite: ${payload.siteDomain}\nWorkspace: ${payload.workspaceName}\nTime: ${payload.timestamp}${
      payload.dashboardUrl ? `\n\nDashboard: ${payload.dashboardUrl}` : ""
    }`;

    // Send to all addresses in parallel
    const results = await Promise.allSettled(
      addresses.map((to) =>
        sendEmail({ to, subject: `[TrackMe] ${payload.title}`, text, html })
      )
    );

    const failed = results.filter((r) => r.status === "rejected" || !("value" in r ? r.value?.success : true));
    if (failed.length === addresses.length) {
      return { ok: false, error: "All email deliveries failed", provider: "email" };
    }

    return { ok: true, provider: "email" };
  } catch (err) {
    return { ok: false, error: String(err), provider: "email" };
  }
}

// ─── Generic Webhook (HMAC-signed) ───────────────────────────────────────────

export async function dispatchToWebhook(
  url: string,
  secret: string | undefined,
  payload: AlertPayload
): Promise<DispatchResult> {
  try {
    const body = JSON.stringify({
      event: "alert.fired",
      payload,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "TrackMe-Alert/1.0",
    };

    if (secret) {
      const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
      headers["X-TrackMe-Signature"] = `sha256=${sig}`;
      headers["X-TrackMe-Timestamp"] = Date.now().toString();
    }

    const res = await fetch(url, { method: "POST", headers, body });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Webhook responded ${res.status}: ${text}`, provider: "webhook" };
    }

    return { ok: true, provider: "webhook" };
  } catch (err) {
    return { ok: false, error: String(err), provider: "webhook" };
  }
}

// ─── Unified Dispatcher ───────────────────────────────────────────────────────

export interface ChannelConfig {
  type: ChannelType;
  config: Record<string, unknown>;
}

export async function dispatchAlert(
  channel: ChannelConfig,
  payload: AlertPayload
): Promise<DispatchResult> {
  switch (channel.type) {
    case "slack": {
      const webhookUrl = channel.config.webhookUrl as string;
      if (!webhookUrl) return { ok: false, error: "Missing webhookUrl", provider: "slack" };
      return dispatchToSlack(webhookUrl, payload);
    }
    case "discord": {
      const webhookUrl = channel.config.webhookUrl as string;
      if (!webhookUrl) return { ok: false, error: "Missing webhookUrl", provider: "discord" };
      return dispatchToDiscord(webhookUrl, payload);
    }
    case "email": {
      const addresses = channel.config.addresses as string[];
      if (!addresses?.length) return { ok: false, error: "Missing email addresses", provider: "email" };
      return dispatchToEmail(addresses, payload);
    }
    case "webhook": {
      const url = channel.config.url as string;
      if (!url) return { ok: false, error: "Missing webhook url", provider: "webhook" };
      return dispatchToWebhook(url, channel.config.secret as string | undefined, payload);
    }
    default:
      return { ok: false, error: `Unknown channel type: ${channel.type}`, provider: "webhook" };
  }
}
