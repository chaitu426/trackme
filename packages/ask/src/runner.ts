import type { SourceId, Step } from "./types.js";
import { getTemplate, type TemplateContext, type TemplateResult } from "./templates.js";
import { MAX_SCOPE_ROWS, resolveRange, type ResolvedRange } from "./scope.js";

/**
 * Runs one template for one tenant. The model supplies a template id and params; this validates the params (so a bad
 * shape becomes a clear "that template was not called correctly" the planner can recover from), enforces that the
 * template's source is switched on in the scope, and caps the rows returned. It never accepts SQL from the caller.
 */

export interface RunnerDeps {
  /** The tenant the run is for; its ids are bound by the queries themselves, never by the model. */
  tenant: { workspaceId: string; siteId: string };
  /** Sources the person has switched on. A template whose source is off is refused by name. */
  sources: Record<SourceId, boolean>;
  /** Clamped client request; the effective cap is min(maxRows, MAX_SCOPE_ROWS). */
  maxRows: number;
  /** Clock, for tests. */
  now?: Date;
}

export interface RunnerResult {
  result: TemplateResult;
  step: Step;
}

export class TemplateRefusedError extends Error {}

/** The row cap the runner actually applies: never above the server maximum. */
export function effectiveMaxRows(maxRows: number): number {
  return Math.max(1, Math.min(Math.floor(maxRows) || MAX_SCOPE_ROWS, MAX_SCOPE_ROWS));
}

export async function runTemplate(
  templateId: string,
  rawParams: unknown,
  range: ResolvedRange,
  deps: RunnerDeps,
  stepSeq: number
): Promise<RunnerResult> {
  const template = getTemplate(templateId);
  if (!template) {
    throw new TemplateRefusedError(`No template "${templateId}". Use one of the ids in the tools list.`);
  }
  if (!deps.sources[template.source]) {
    throw new TemplateRefusedError(`That needs ${template.source} data, which is switched off for this question.`);
  }

  const parsed = template.params.safeParse(rawParams ?? {});
  if (!parsed.success) {
    throw new TemplateRefusedError(`Parameters for "${templateId}" did not validate: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }

  const cap = effectiveMaxRows(deps.maxRows);
  const ctx: TemplateContext = { tenant: deps.tenant, maxRows: cap, range };

  const started = Date.now();
  const result = await template.run(ctx, parsed.data);
  const ms = Math.max(1, Date.now() - started);
  const rows = result.rows.slice(0, cap);

  // A template run twice with different parameters must read differently, so the step carries what was asked of it.
  const asked = Object.values(parsed.data as Record<string, unknown>)
    .filter((v) => v !== "" && v !== undefined && v !== null)
    .map((v) => (Array.isArray(v) ? v.join(",") : String(v)))
    .join(" · ");
  return {
    result: { ...result, rows },
    step: {
      id: `q${stepSeq}`,
      label: asked ? `${result.title}: ${asked}` : result.title,
      detail: `${rows.length} ${rows.length === 1 ? "row" : "rows"}`,
      tool: { table: result.table, rows: rows.length },
      ms,
    },
  };
}

export function rangeFor(rangeId: Parameters<typeof resolveRange>[0], now?: Date): ResolvedRange {
  return resolveRange(rangeId, now);
}

/** Params the planner sent, as a JSON object; anything else becomes `{}` so the template's zod decides. */
export function asParams(v: unknown): unknown {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
}
