import { decryptSecret, encryptSecret } from "./secret-box";

/**
 * A notification channel's config holds bearer secrets: a Slack or Discord webhook URL lets whoever has it post
 * to that channel, and a webhook's signing secret lets them forge deliveries. They are encrypted at rest
 * (lib/secret-box), so a database leak does not hand them over. Decrypt only at the moment of use.
 */
const SECRET_FIELDS = ["webhookUrl", "url", "secret"] as const;

function mapSecrets(config: Record<string, unknown>, fn: (value: string) => string): Record<string, unknown> {
  const out = { ...config };
  for (const field of SECRET_FIELDS) {
    const value = out[field];
    if (typeof value === "string" && value) out[field] = fn(value);
  }
  return out;
}

export const encryptChannelConfig = (config: Record<string, unknown>): Record<string, unknown> => mapSecrets(config, (v) => encryptSecret(v));

/** Values stored before encryption existed are plaintext and pass through unchanged. */
export const decryptChannelConfig = (config: Record<string, unknown>): Record<string, unknown> =>
  mapSecrets(config, (v) => decryptSecret(v) ?? v);
