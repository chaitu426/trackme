/**
 * A usage bar drawn in the product's glyph ramp (`.` `:` `+` `#`, the same one the landing page and every page header
 * use) instead of a plain progress rail. Pure, so the shape is testable; the component only paints it.
 */
export type MeterState = "ok" | "warn" | "full" | "unlimited";

export interface GlyphBar {
  /** The filled part, left to right: a run of `#` that fades out through `+` then `:`. Its length is the filled cells. */
  filled: string;
  /** How many cells the whole bar has. */
  cells: number;
  ratio: number;
  state: MeterState;
}

export const WARN_AT = 0.8;

export function glyphBar(value: number, limit: number | null, cells = 28): GlyphBar {
  if (limit === null) return { filled: "", cells, ratio: 0, state: "unlimited" };
  const ratio = limit <= 0 ? 1 : Math.max(0, value / limit);
  // Any use at all shows at least one cell, and a bar is only completely full once the limit is reached.
  let count = Math.round(Math.min(ratio, 1) * cells);
  if (value > 0 && count === 0) count = 1;
  if (ratio < 1 && count === cells) count = cells - 1;
  const fade = count >= 3 ? "+:" : count === 2 ? ":" : "";
  const filled = ratio >= 1 ? "#".repeat(cells) : "#".repeat(Math.max(0, count - fade.length)) + fade;
  return { filled, cells, ratio, state: ratio >= 1 ? "full" : ratio >= WARN_AT ? "warn" : "ok" };
}
