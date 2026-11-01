import { z } from "zod";

/**
 * What a segment can say. Shared by the API (which validates) and the builder (which
 * constructs), so neither can drift from the other. Profile conditions run in Postgres
 * against the identified-user table; behaviour conditions run in ClickHouse against the
 * events those users generated.
 */
const TraitKey = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.\- ]+$/, "Trait names use letters, numbers, _ . - and spaces");

export const TRAIT_OPS = ["eq", "neq", "contains", "exists", "missing", "gt", "lt"] as const;

export const ProfileConditionSchema = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("trait"),
    key: TraitKey,
    op: z.enum(TRAIT_OPS),
    value: z.string().trim().max(200).optional(),
  }),
  z.object({ field: z.literal("lastSeen"), op: z.enum(["within", "before"]), days: z.number().int().min(1).max(3650) }),
  z.object({ field: z.literal("firstSeen"), op: z.enum(["within", "before"]), days: z.number().int().min(1).max(3650) }),
  z.object({ field: z.literal("sessions"), op: z.enum(["gte", "lte"]), value: z.number().int().min(0).max(1_000_000) }),
  z.object({ field: z.literal("events"), op: z.enum(["gte", "lte"]), value: z.number().int().min(0).max(100_000_000) }),
  z.object({ field: z.literal("email"), op: z.enum(["exists", "missing", "contains"]), value: z.string().trim().max(200).optional() }),
]);

export const BehaviorConditionSchema = z.object({
  op: z.enum(["did", "did_not"]),
  kind: z.enum(["pageview", "custom_event"]),
  target: z.string().trim().min(1).max(256),
  days: z.number().int().min(1).max(365),
});

export const SegmentDefinitionSchema = z.object({
  /** How the profile conditions combine. Behaviour conditions always all apply. */
  match: z.enum(["all", "any"]),
  conditions: z.array(ProfileConditionSchema).max(10),
  behavior: z.array(BehaviorConditionSchema).max(4),
});

export type ProfileCondition = z.infer<typeof ProfileConditionSchema>;
export type BehaviorCondition = z.infer<typeof BehaviorConditionSchema>;
export type SegmentDefinition = z.infer<typeof SegmentDefinitionSchema>;

export const EMPTY_SEGMENT: SegmentDefinition = { match: "all", conditions: [], behavior: [] };

/** A one-line, human reading of a condition, for chips and previews. */
export function describeCondition(c: ProfileCondition): string {
  switch (c.field) {
    case "trait": {
      const v = c.value ?? "";
      const text = { eq: `= ${v}`, neq: `≠ ${v}`, contains: `contains ${v}`, exists: "is set", missing: "is not set", gt: `> ${v}`, lt: `< ${v}` }[c.op];
      return `${c.key} ${text}`;
    }
    case "lastSeen":
      return c.op === "within" ? `active in the last ${c.days}d` : `inactive for ${c.days}d+`;
    case "firstSeen":
      return c.op === "within" ? `joined in the last ${c.days}d` : `joined ${c.days}d+ ago`;
    case "sessions":
      return `${c.op === "gte" ? "at least" : "at most"} ${c.value} sessions`;
    case "events":
      return `${c.op === "gte" ? "at least" : "at most"} ${c.value} events`;
    case "email":
      return c.op === "contains" ? `email contains ${c.value ?? ""}` : c.op === "exists" ? "has an email" : "has no email";
  }
}

export function describeBehavior(b: BehaviorCondition): string {
  const what = b.kind === "pageview" ? `visited ${b.target}` : `triggered ${b.target}`;
  return `${b.op === "did" ? "" : "never "}${what} in the last ${b.days}d`;
}

/** True when a condition has everything it needs to run. */
export function isCompleteCondition(c: ProfileCondition): boolean {
  if (c.field === "trait") {
    if (!c.key.trim()) return false;
    return c.op === "exists" || c.op === "missing" || Boolean(c.value?.trim());
  }
  if (c.field === "email") return c.op !== "contains" || Boolean(c.value?.trim());
  return true;
}
