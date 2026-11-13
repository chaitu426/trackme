import { z } from "zod";
import { RANGES, SOURCES, type AskScope, type RangeId, type SourceId } from "./types.js";

/**
 * Server-side rules for a client-supplied scope. The browser sends `AskScope`, but it is untrusted: the range and row
 * cap decide how much ClickHouse is asked to read, so they are clamped here, never trusted.
 */

export const MAX_SCOPE_ROWS = 1_000;
export const MAX_INSTRUCTIONS = 800;
export const MAX_QUESTION = 600;
export const MAX_HISTORY_TURNS = 6;
export const MAX_HISTORY_ANSWER = 1_500;

const RANGE_IDS = RANGES.map((r) => r.id) as [RangeId, ...RangeId[]];
const SOURCE_IDS = SOURCES.map((s) => s.id) as [SourceId, ...SourceId[]];

/** A site's domain as stored (`acme.com`, `localhost:3000`): a hostname, optionally with an explicit port. */
const Domain = z
  .string()
  .trim()
  .min(1)
  .max(261)
  .regex(/^[a-z0-9.-]+(?::\d{1,5})?$/i, "a site domain");

export const ScopeInputSchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(120),
  siteDomains: z.array(Domain).max(10),
  range: z.enum(RANGE_IDS),
  sources: z.record(z.enum(SOURCE_IDS), z.boolean()),
  piiMasked: z.boolean().default(true),
  maxRows: z.number().int().positive().max(MAX_SCOPE_ROWS).default(MAX_SCOPE_ROWS),
  instructions: z.string().max(MAX_INSTRUCTIONS).default(""),
  page: z.string().trim().max(80).optional(),
  history: z
    .array(z.object({ question: z.string().max(MAX_QUESTION), answer: z.string().max(MAX_HISTORY_ANSWER) }))
    .max(MAX_HISTORY_TURNS)
    .optional(),
});

export const RunInputSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION),
  scope: ScopeInputSchema,
});
export type RunInput = z.infer<typeof RunInputSchema>;

/** Every source present, exactly once, defaulting to off, so a partial record from the client cannot smuggle an unlisted source on. */
function normalizeSources(input: Partial<Record<SourceId, boolean>>): Record<SourceId, boolean> {
  const out = {} as Record<SourceId, boolean>;
  for (const id of SOURCE_IDS) out[id] = input[id] === true;
  return out;
}

/** The scope as the server will honour it: clamped, every source listed, no extra keys. */
export function clampScope(input: z.infer<typeof ScopeInputSchema>): AskScope {
  return {
    workspaceSlug: input.workspaceSlug,
    siteDomains: input.siteDomains.slice(0, 10),
    range: input.range,
    sources: normalizeSources(input.sources),
    piiMasked: input.piiMasked,
    maxRows: Math.min(input.maxRows, MAX_SCOPE_ROWS),
    instructions: input.instructions.slice(0, MAX_INSTRUCTIONS),
    ...(input.page ? { page: input.page } : {}),
    ...(input.history?.length ? { history: input.history.slice(-MAX_HISTORY_TURNS) } : {}),
  };
}

const RANGE_HOURS: Record<RangeId, number> = { "24h": 24, "7d": 7 * 24, "30d": 30 * 24, "90d": 90 * 24 };

export interface ResolvedRange {
  /** Inclusive UTC date, YYYY-MM-DD. */
  from: string;
  /** Inclusive UTC date, YYYY-MM-DD. */
  to: string;
  /** ISO datetimes for queries that take instants. */
  fromIso: string;
  toIso: string;
  /** Human text: "Last 30 days". */
  label: string;
}

const DAY_MS = 86_400_000;

/** A rolling range ending now, as inclusive UTC days. `now` is passed in so a run is reproducible in tests. */
export function resolveRange(range: RangeId, now: Date = new Date()): ResolvedRange {
  const hours = RANGE_HOURS[range];
  const toIso = now.toISOString();
  const fromIso = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const label = RANGES.find((r) => r.id === range)?.label ?? `Last ${range}`;
  return {
    from: fromIso.slice(0, 10),
    to: toIso.slice(0, 10),
    fromIso,
    toIso,
    label,
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

/**
 * A range for a query that must read raw events, which the analytics layer only allows for `maxDays`. A wider question
 * ("last 90 days") is answered from the most recent `maxDays` and says so, instead of failing and leaving the model with
 * nothing. `note` is set only when the range was shortened, so the evidence is never silently narrower than it looks.
 */
export function clampToRawScan(range: ResolvedRange, maxDays: number): { fromIso: string; toIso: string; note?: string } {
  const to = Date.parse(range.toIso);
  const from = Date.parse(range.fromIso);
  if ((to - from) / 86_400_000 <= maxDays) return { fromIso: range.fromIso, toIso: range.toIso };
  return {
    fromIso: new Date(to - maxDays * 86_400_000).toISOString(),
    toIso: range.toIso,
    note: `Page-level data is read from raw events, so this covers the last ${maxDays} days, not ${range.label.toLowerCase()}.`,
  };
}
