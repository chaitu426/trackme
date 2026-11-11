import type { Answer, Block, EvidenceItem } from "./types.js";

/**
 * The grounding gate. Before an answer reaches the person, every citation must point at an evidence item that exists, and
 * every number written in prose must appear in the sample of the evidence it cites. This is mechanical on purpose: a
 * model that invents a figure can be stopped here without judging the sentence around it.
 *
 * What it does:
 *   - drops a stat/bar/table/spark entry whose `cite` names no evidence, rather than showing a free-standing number;
 *   - drops a whole `text` block if it cites evidence that does not exist (its figures cannot be trusted);
 *   - drops any trail node whose citation is missing, and the whole trail if fewer than two nodes survive;
 *   - reports what it dropped so the worker can log it and lower confidence.
 */

export interface GroundingReport {
  answer: Answer;
  dropped: string[];
  grounded: boolean;
}

/** Every citation number an answer's blocks and trail reference, in order. Mirrors the demo engine's `citationsOf`. */
export function citationsOf(answer: Answer): number[] {
  const found: number[] = [];
  for (const b of answer.blocks) {
    if (b.type === "text") for (const m of b.text.matchAll(/\[(\d+)\]/g)) found.push(Number(m[1]));
    if (b.type === "stats") for (const i of b.items) if (i.cite) found.push(i.cite);
    if (b.type === "bars") for (const r of b.rows) if (r.cite) found.push(r.cite);
    if ((b.type === "table" || b.type === "spark") && b.cite) found.push(b.cite);
  }
  for (const n of answer.trail?.nodes ?? []) if (n.cite) found.push(n.cite);
  return found;
}

/** Numbers written in a string, normalized: "₹195,970" and "195970" both become "195970"; "61.8%" becomes "61.8". */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  // A minus counts as a sign only when it does not follow a digit or letter, so "2026-11-10" and "3-5" are not negatives.
  for (const m of text.matchAll(/(?:(?<![\w.])-)?\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    if (raw === "" || raw === "-") continue;
    out.push(raw);
  }
  return out;
}

/** Every number present anywhere in an evidence item's columns or sample, as the same normalized strings. */
function numbersInEvidence(ev: EvidenceItem): Set<string> {
  const set = new Set<string>();
  for (const row of ev.sample) {
    for (const cell of row) {
      for (const n of numbersIn(String(cell))) set.add(n);
    }
  }
  return set;
}

export interface GroundingOptions {
  /** Figures the planner computed with its `calculate` tool; exact, so they are as good as evidence. */
  derived?: string[];
  /** Figures that come from the question's own frame (the range length, for example) rather than from data. */
  allowed?: string[];
}

const decimalsOf = (raw: string): number => (raw.split(".")[1] ?? "").length;
const roundTo = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

/**
 * True when the figure is in the cited evidence, was computed by the calculator, belongs to the question's frame, or is the
 * evidence figure rounded the way a person would write it ("61.84" cited, "61.8" written; a 0.618 share written as 61.8%).
 */
function figureKnown(raw: string, known: Set<string>, knownNums: number[], opts: GroundingOptions): boolean {
  if (known.has(raw) || opts.derived?.includes(raw) || opts.allowed?.includes(raw)) return true;
  const x = Number(raw);
  if (!Number.isFinite(x)) return false;
  const d = decimalsOf(raw);
  const candidates = [...knownNums, ...(opts.derived ?? []).map(Number)];
  return candidates.some((y) => roundTo(y, d) === x || roundTo(y * 100, d) === x);
}

/** True when every number in `text` is grounded. Citation markers [n] are not figures. */
function figuresGrounded(text: string, cited: EvidenceItem[], opts: GroundingOptions): boolean {
  const known = new Set<string>();
  for (const ev of cited) for (const v of numbersInEvidence(ev)) known.add(v);
  const knownNums = [...known].map(Number).filter(Number.isFinite);
  const prose = text.replace(/\[\d+\]/g, " ");
  for (const num of numbersIn(prose)) if (!figureKnown(num, known, knownNums, opts)) return false;
  return true;
}

export function groundAnswer(input: Answer, opts: GroundingOptions = {}): GroundingReport {
  const byN = new Map(input.evidence.map((e) => [e.n, e]));
  const dropped: string[] = [];

  const blockOk = (b: Block): boolean => {
    const cites: number[] = [];
    if (b.type === "text") for (const m of b.text.matchAll(/\[(\d+)\]/g)) cites.push(Number(m[1]));
    if (b.type === "stats") for (const i of b.items) if (i.cite) cites.push(i.cite);
    if (b.type === "bars") for (const r of b.rows) if (r.cite) cites.push(r.cite);
    if ((b.type === "table" || b.type === "spark") && b.cite !== undefined) cites.push(b.cite);
    const missing = cites.filter((n) => !byN.has(n));
    if (missing.length > 0) {
      // A text block's figures cannot be trusted if any of its citations is missing: drop the whole block.
      if (b.type === "text") {
        dropped.push(`text block cites evidence that does not exist (${missing.join(", ")})`);
        return false;
      }
      // A table/spark citing one missing item has no fallback: drop it. Stats and bars are salvaged per entry below.
      if (b.type === "table" || b.type === "spark") {
        dropped.push(`${b.type} block cites evidence that does not exist (${missing.join(", ")})`);
        return false;
      }
    }
    if (b.type === "text") {
      const cited = cites.map((n) => byN.get(n)).filter((e): e is EvidenceItem => e !== undefined);
      if (!figuresGrounded(b.text, cited, opts)) {
        dropped.push("text block has a figure not found in its cited evidence");
        return false;
      }
    }
    return true;
  };

  let blocks = input.blocks.filter(blockOk);

  // Filter per-entry inside stats/bars so one bad citation does not drop a whole block of good ones; drop a block that
  // is left with nothing to show.
  blocks = blocks
    .map((b) => {
      if (b.type === "stats") return { ...b, items: b.items.filter((i) => i.cite === undefined || byN.has(i.cite)) };
      if (b.type === "bars") return { ...b, rows: b.rows.filter((r) => r.cite === undefined || byN.has(r.cite)) };
      return b;
    })
    .filter((b) => {
      if (b.type === "stats" && b.items.length === 0) {
        dropped.push("stats block left with no grounded entries");
        return false;
      }
      if (b.type === "bars" && b.rows.length === 0) {
        dropped.push("bars block left with no grounded entries");
        return false;
      }
      return true;
    });

  let trail = input.trail;
  if (trail) {
    const nodes = trail.nodes.filter((n) => {
      if (n.cite !== undefined && !byN.has(n.cite)) {
        dropped.push(`trail node "${n.title}" cites missing evidence`);
        return false;
      }
      return true;
    });
    trail = nodes.length >= 2 ? { ...trail, nodes } : undefined;
    if (!trail) dropped.push("trail dropped: fewer than two grounded links remain");
  }

  const grounded = blocks.length > 0;
  const answer: Answer = { ...input, blocks };
  if (trail) answer.trail = trail;
  else delete answer.trail;
  return { answer, dropped, grounded };
}

/**
 * What the person sees when the gate dropped every block: the evidence itself, as tables, with a plain note. A run that found
 * data must never end as "done" with nothing on screen, and must never show an unverified sentence in its place.
 */
export function fallbackAnswer(answer: Answer, dropped: string[]): Answer {
  const tables: Block[] = answer.evidence.slice(0, 4).map((e) => ({
    type: "table" as const,
    title: e.title,
    columns: e.columns,
    rows: e.sample.map((r) => r.map((c) => String(c))),
    cite: e.n,
  }));
  const blocks: Block[] =
    tables.length > 0
      ? [
          {
            type: "callout",
            tone: "warn",
            text: "I found the data but could not verify a written summary against it, so here are the results themselves.",
          },
          ...tables,
        ]
      : [{ type: "text", text: "I could not find data to answer that from the sources switched on." }];
  return {
    ...answer,
    blocks,
    confidence: "low",
    assumptions: [...answer.assumptions, ...(dropped.length ? ["The written summary failed the figure check and was withheld."] : [])],
  };
}
