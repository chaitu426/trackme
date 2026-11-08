import { UnsafeUrlError, parseOutboundUrl } from "./safe-fetch";

/**
 * Checks a webhook URL when a channel is saved, so the mistake (or the attack) is rejected up front and with a
 * clear message. safePost() repeats the network-level checks on every send; this adds provider rules:
 * a Slack channel must point at Slack, a Discord channel at Discord.
 */
export type WebhookKind = "slack" | "discord" | "webhook";

export function webhookUrlProblem(kind: WebhookKind, raw: string): string | null {
  let url: URL;
  try {
    url = parseOutboundUrl(raw);
  } catch (err) {
    return err instanceof UnsafeUrlError ? err.message : "The URL is not valid.";
  }
  const host = url.hostname.toLowerCase();
  if (kind === "slack" && host !== "hooks.slack.com") return "Slack webhooks must start with https://hooks.slack.com/.";
  if (kind === "discord") {
    const ok = (host === "discord.com" || host === "discordapp.com" || host.endsWith(".discord.com")) && url.pathname.startsWith("/api/webhooks/");
    if (!ok) return "Discord webhooks must start with https://discord.com/api/webhooks/.";
  }
  return null;
}
