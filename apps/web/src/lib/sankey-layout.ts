import type { FlowGraph } from "@trackme/analytics";
import { NEUTRAL_COLOR, pageColor } from "./page-color";

// Mirrors analytics' OTHER_NODE / EXIT_NODE (kept literal so this file stays importable
// from client code without pulling the ClickHouse client into the bundle).
const OTHER = "__other__";
const EXIT = "__exit__";

export interface LaidOutNode {
  id: string;
  step: number;
  page: string;
  kind: "page" | "other" | "exit";
  sessions: number;
  x: number;
  y: number;
  h: number;
  color: string;
}

export interface LaidOutLink {
  key: string;
  source: string;
  target: string;
  sessions: number;
  d: string;
  width: number;
  color: string;
}

export interface SankeyLayout {
  width: number;
  height: number;
  nodeWidth: number;
  nodes: LaidOutNode[];
  links: LaidOutLink[];
}

export interface SankeyOptions {
  width?: number;
  height?: number;
  nodeWidth?: number;
  /** Room above each node for its label. */
  gap?: number;
  padX?: number;
  padTop?: number;
  padBottom?: number;
}

const kindOf = (page: string): LaidOutNode["kind"] => (page === EXIT ? "exit" : page === OTHER ? "other" : "page");

/** Computes node rectangles and link curves for a flow graph. Pure, so it can be tested. */
export function layoutSankey(graph: FlowGraph, options: SankeyOptions = {}): SankeyLayout {
  const { width = 1000, height = 520, nodeWidth = 14, gap = 36, padX = 64, padTop = 30, padBottom = 12 } = options;
  const steps = Math.max(graph.steps, 1);
  const innerH = height - padTop - padBottom;

  const columns = new Map<number, typeof graph.nodes>();
  for (const node of graph.nodes) {
    const col = columns.get(node.step) ?? [];
    col.push(node);
    columns.set(node.step, col);
  }
  const rank = (page: string) => (page === EXIT ? 2 : page === OTHER ? 1 : 0);
  for (const col of columns.values()) {
    col.sort((a, b) => rank(a.page) - rank(b.page) || b.sessions - a.sessions);
  }

  // One scale for the whole diagram, so a link keeps its width from end to end.
  let scale = Infinity;
  for (const col of columns.values()) {
    const total = col.reduce((sum, n) => sum + n.sessions, 0);
    const room = innerH - (col.length - 1) * gap;
    if (total > 0) scale = Math.min(scale, room / total);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const span = steps > 1 ? (width - padX * 2 - nodeWidth) / (steps - 1) : 0;
  const placed = new Map<string, LaidOutNode>();
  for (const [step, col] of columns) {
    const x = steps > 1 ? padX + (step - 1) * span : (width - nodeWidth) / 2;
    let y = padTop;
    for (const node of col) {
      const h = Math.max(node.sessions * scale, 3);
      const kind = kindOf(node.page);
      placed.set(node.id, {
        id: node.id,
        step,
        page: node.page,
        kind,
        sessions: node.sessions,
        x,
        y,
        h,
        color: kind === "page" ? pageColor(node.page) : NEUTRAL_COLOR,
      });
      y += h + gap;
    }
  }

  // Stack each node's links in the order of the nodes at their far ends, which keeps ribbons from crossing needlessly.
  const valid = graph.links.filter((l) => placed.has(l.source) && placed.has(l.target));
  const bySource = new Map<string, typeof valid>();
  const byTarget = new Map<string, typeof valid>();
  for (const link of valid) {
    bySource.set(link.source, [...(bySource.get(link.source) ?? []), link]);
    byTarget.set(link.target, [...(byTarget.get(link.target) ?? []), link]);
  }
  const yOf = (id: string) => placed.get(id)!.y;
  const sourceOffset = new Map<string, number>();
  const targetOffset = new Map<string, number>();
  for (const list of bySource.values()) {
    list.sort((a, b) => yOf(a.target) - yOf(b.target));
    let acc = 0;
    for (const link of list) {
      sourceOffset.set(`${link.source}>${link.target}`, acc);
      acc += link.sessions * scale;
    }
  }
  for (const list of byTarget.values()) {
    list.sort((a, b) => yOf(a.source) - yOf(b.source));
    let acc = 0;
    for (const link of list) {
      targetOffset.set(`${link.source}>${link.target}`, acc);
      acc += link.sessions * scale;
    }
  }

  const links: LaidOutLink[] = valid.map((link) => {
    const s = placed.get(link.source)!;
    const t = placed.get(link.target)!;
    const key = `${link.source}>${link.target}`;
    const w = Math.max(link.sessions * scale, 1.5);
    const y0 = s.y + (sourceOffset.get(key) ?? 0) + w / 2;
    const y1 = t.y + (targetOffset.get(key) ?? 0) + w / 2;
    const x0 = s.x + nodeWidth;
    const x1 = t.x;
    const mid = (x0 + x1) / 2;
    return {
      key,
      source: link.source,
      target: link.target,
      sessions: link.sessions,
      d: `M${x0} ${y0} C${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`,
      width: w,
      color: s.kind === "page" && t.kind !== "exit" ? s.color : NEUTRAL_COLOR,
    };
  });

  return { width, height, nodeWidth, nodes: [...placed.values()], links };
}
