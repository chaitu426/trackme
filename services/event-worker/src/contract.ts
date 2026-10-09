import { EnrichedEventSchema, type EnrichedEvent } from "@trackme/contracts";

export type Verdict =
  | { ok: true; event: EnrichedEvent }
  | { ok: false; reason: string };

/**
 * Check one decoded Kafka message against the shared event contract.
 *
 * The edge validates too, but the worker cannot trust that every producer ran
 * the same version of the checks. A message that fails here is dead-lettered on
 * its own instead of failing the ClickHouse insert for the whole batch.
 */
export function checkEvent(raw: unknown): Verdict {
  const result = EnrichedEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, event: result.data };
  }
  const issue = result.error.issues[0];
  const where = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return { ok: false, reason: `contract: ${where}: ${issue?.message ?? "invalid event"}` };
}
