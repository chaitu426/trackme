/**
 * What the person is told when a run fails. The detail (provider text, SQL, stack) stays in the worker log; the message is a
 * sentence they can act on. Every failure the planner or provider can raise maps to one of these, so the panel never shows
 * a generic "could not finish" for a cause we can name.
 */

export class AskFailure extends Error {
  constructor(
    readonly code: "steps" | "empty" | "invalid_finish" | "cancelled" | "busy_provider" | "timeout" | "provider_auth" | "provider" | "unknown",
    message: string
  ) {
    super(message);
  }
}

const MESSAGES: Record<AskFailure["code"], string> = {
  steps: "This question needed more lookups than one answer allows. Try a narrower question, a shorter range, or one site at a time.",
  empty: "The model came back empty. Try again, or ask it another way.",
  invalid_finish: "The model's answer was malformed. Try again.",
  cancelled: "Stopped.",
  busy_provider: "The AI provider is busy right now. Wait a few seconds and try again.",
  timeout: "The AI provider took too long to respond. Try again, or ask something narrower.",
  provider_auth: "Ask is misconfigured on this deployment (the AI provider rejected the key). An administrator needs to check it.",
  provider: "The AI provider returned an error. Try again in a moment.",
  unknown: "Ask could not finish this question. Try again, or ask it another way.",
};

export function messageFor(code: AskFailure["code"]): string {
  return MESSAGES[code];
}

/** Classify any thrown value into an `AskFailure`. Understands the OpenAI SDK's `status` and network error names. */
export function classifyFailure(err: unknown): AskFailure {
  if (err instanceof AskFailure) return err;
  const e = err as { status?: number; name?: string; code?: string; message?: string } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const text = `${e?.name ?? ""} ${e?.code ?? ""} ${e?.message ?? ""}`;
  if (status === 401 || status === 403) return new AskFailure("provider_auth", MESSAGES.provider_auth);
  if (status === 429) return new AskFailure("busy_provider", MESSAGES.busy_provider);
  if (/timeout|timed out|ETIMEDOUT|AbortError|APIConnectionTimeout/i.test(text)) return new AskFailure("timeout", MESSAGES.timeout);
  if (status !== undefined && status >= 500) return new AskFailure("provider", MESSAGES.provider);
  if (/ECONNRESET|ENOTFOUND|ECONNREFUSED|APIConnectionError|fetch failed/i.test(text)) return new AskFailure("provider", MESSAGES.provider);
  return new AskFailure("unknown", MESSAGES.unknown);
}
