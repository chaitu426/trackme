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
import { renderAlertEmail, sendEmail } from "./email";
import { safePost } from "./safe-fetch";
import { decryptChannelConfig } from "./channel-config";

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

    const res = await safePost(webhookUrl, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Only the status is reported. The remote reply is never read, so this can not be used to read back what
    // an internal service answers.
    if (!res.ok) {
      return { ok: false, error: `Slack responded ${res.status}`, provider: "slack" };
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

    const res = await safePost(webhookUrl, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Only the status is reported. The remote reply is never read, so this can not be used to read back what
    // an internal service answers.
    if (!res.ok) {
      return { ok: false, error: `Discord responded ${res.status}`, provider: "discord" };
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
    const { subject, text, html } = renderAlertEmail(payload);

    // Send to all addresses in parallel
    const results = await Promise.allSettled(
      addresses.map((to) =>
        sendEmail({ to, subject, text, html })
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

    const res = await safePost(url, { headers, body });

    if (!res.ok) {
      return { ok: false, error: `Webhook responded ${res.status}`, provider: "webhook" };
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
  // Secrets are stored encrypted; they exist in plaintext only here, for the duration of one send.
  const config = decryptChannelConfig(channel.config);
  switch (channel.type) {
    case "slack": {
      const webhookUrl = config.webhookUrl as string;
      if (!webhookUrl) return { ok: false, error: "Missing webhookUrl", provider: "slack" };
      return dispatchToSlack(webhookUrl, payload);
    }
    case "discord": {
      const webhookUrl = config.webhookUrl as string;
      if (!webhookUrl) return { ok: false, error: "Missing webhookUrl", provider: "discord" };
      return dispatchToDiscord(webhookUrl, payload);
    }
    case "email": {
      const addresses = config.addresses as string[];
      if (!addresses?.length) return { ok: false, error: "Missing email addresses", provider: "email" };
      return dispatchToEmail(addresses, payload);
    }
    case "webhook": {
      const url = config.url as string;
      if (!url) return { ok: false, error: "Missing webhook url", provider: "webhook" };
      return dispatchToWebhook(url, config.secret as string | undefined, payload);
    }
    default:
      return { ok: false, error: `Unknown channel type: ${channel.type}`, provider: "webhook" };
  }
}
