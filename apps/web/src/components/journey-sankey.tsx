"use client";

import * as React from "react";
import { Pause, Play } from "lucide-react";
import type { FlowGraph } from "@trackme/analytics";
import { layoutSankey, type LaidOutLink, type LaidOutNode } from "@/lib/sankey-layout";
import { formatNumber } from "@/lib/format";
import { useRouter } from "next/navigation";

const OTHER = "__other__";
const EXIT = "__exit__";

interface Tip {
  x: number;
  y: number;
  title: string;
  color: string;
  lines: string[];
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const v = (part / whole) * 100;
  if (v > 0 && v < 0.1) return "<0.1%";
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

function labelOf(node: Pick<LaidOutNode, "kind" | "page">): string {
  if (node.kind === "exit") return "Left the site";
  if (node.kind === "other") return "Other pages";
  return node.page;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Where sessions go, step by step. Columns are the 1st, 2nd, 3rd… distinct page of a
 * session; ribbons are the sessions moving between pages. Hover or click a page to light
 * up everything that flows through it, or pass `route` to trace one journey end to end.
 */
export function JourneySankey({
  graph,
  route,
  compact = false,
  href,
}: {
  graph: FlowGraph;
  route?: string[];
  compact?: boolean;
  /** When set, clicking the diagram opens this page (the full journeys view) instead of pinning a page. */
  href?: string;
}) {
  const router = useRouter();
  const layout = React.useMemo(
    () =>
      layoutSankey(
        graph,
        compact
          ? { padTop: 40, gap: 30, height: 330, nodeWidth: 10, padX: 56 }
          : { padTop: 48, gap: 38, height: 540 }
      ),
    [graph, compact]
  );
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [tip, setTip] = React.useState<Tip | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const nodeById = React.useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  // Everything upstream and downstream of a node, so the highlight is the whole path through it.
  const reach = React.useMemo(() => {
    const focus = pinned ?? hovered;
    if (!focus) return null;
    const nodes = new Set<string>([focus]);
    const links = new Set<string>();
    for (const dir of ["down", "up"] as const) {
      const queue = [focus];
      while (queue.length) {
        const id = queue.pop()!;
        for (const link of layout.links) {
          const from = dir === "down" ? link.source : link.target;
          const to = dir === "down" ? link.target : link.source;
          if (from !== id) continue;
          links.add(link.key);
          if (!nodes.has(to)) {
            nodes.add(to);
            queue.push(to);
          }
        }
      }
    }
    return { nodes, links };
  }, [pinned, hovered, layout]);

  // The selected route, mapped onto the diagram (pages outside the top set fall under "other").
  const routeSet = React.useMemo(() => {
    if (!route || route.length === 0) return null;
    const ids: string[] = [];
    route.forEach((page, i) => {
      const step = i + 1;
      const exact = layout.nodes.find((n) => n.step === step && n.page === page);
      const fallback = layout.nodes.find((n) => n.step === step && n.page === OTHER);
      const found = exact ?? fallback;
      if (found) ids.push(found.id);
    });
    const order: string[] = [];
    for (let i = 0; i < ids.length - 1; i += 1) order.push(`${ids[i]}>${ids[i + 1]}`);
    return { nodes: new Set(ids), links: new Set(order), order };
  }, [route, layout]);

  // Replay: dots travel the route's ribbons, hop by hop. Drawn straight onto the SVG each
  // frame (no React state), and only while playing.
  const routeKey = route?.join("") ?? "";
  const [playing, setPlaying] = React.useState(false);
  const pathRefs = React.useRef(new Map<string, SVGPathElement>());
  const dotRefs = React.useRef<(SVGGElement | null)[]>([]);
  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlaying(routeKey !== "" && !reduce);
  }, [routeKey]);

  React.useEffect(() => {
    const hide = () => dotRefs.current.forEach((dot) => dot?.setAttribute("opacity", "0"));
    if (!playing || !routeSet) {
      hide();
      return;
    }
    const hops = routeSet.order
      .map((key) => ({ el: pathRefs.current.get(key), color: layout.links.find((l) => l.key === key)?.color ?? "#fff" }))
      .filter((h): h is { el: SVGPathElement; color: string } => Boolean(h.el));
    const lengths = hops.map((h) => h.el.getTotalLength());
    const total = lengths.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    const SPEED = 230; // diagram units per second
    const DOTS = 4;
    const PAUSE = 140; // a beat of empty space before the loop restarts
    const cycle = total + PAUSE;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const travelled = ((now - start) / 1000) * SPEED;
      dotRefs.current.forEach((dot, j) => {
        if (!dot) return;
        const d = (travelled + (j * cycle) / DOTS) % cycle;
        if (d > total) {
          dot.setAttribute("opacity", "0");
          return;
        }
        let rest = d;
        let hop = 0;
        while (hop < hops.length - 1 && rest > lengths[hop]!) {
          rest -= lengths[hop]!;
          hop += 1;
        }
        const { el, color } = hops[hop]!;
        const point = el.getPointAtLength(Math.min(rest, lengths[hop]!));
        dot.setAttribute("transform", `translate(${point.x} ${point.y})`);
        dot.setAttribute("opacity", String(Math.min(1, d / 30, (total - d) / 30)));
        dot.style.color = color;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      hide();
    };
  }, [playing, routeSet, layout]);

  const active = reach ?? routeSet;

  function point(event: React.PointerEvent): { x: number; y: number } {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function showNode(event: React.PointerEvent, node: LaidOutNode) {
    setHovered(node.id);
    const out = layout.links.filter((l) => l.source === node.id).reduce((s, l) => s + l.sessions, 0);
    const lines = [`${formatNumber(node.sessions)} sessions · ${pct(node.sessions, graph.totalSessions)} of all`];
    if (node.kind !== "exit" && node.step < graph.steps) {
      lines.push(`${pct(out, node.sessions)} continue · ${pct(node.sessions - out, node.sessions)} leave`);
    }
    setTip({ ...point(event), title: labelOf(node), color: node.color, lines });
  }

  function showLink(event: React.PointerEvent, link: LaidOutLink) {
    const s = nodeById.get(link.source);
    const t = nodeById.get(link.target);
    if (!s || !t) return;
    setTip({
      ...point(event),
      title: `${labelOf(s)}  →  ${labelOf(t)}`,
      color: link.color,
      lines: [`${formatNumber(link.sessions)} sessions`, `${pct(link.sessions, s.sessions)} of ${labelOf(s)}`],
    });
  }

  if (graph.nodes.length === 0 || graph.steps < 2) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-zinc-500">
        Flows appear once visitors view more than one page in a session.
      </div>
    );
  }

  const nodeOpacity = (id: string) => (active ? (active.nodes.has(id) ? 1 : 0.22) : 1);
  const linkOpacity = (key: string) => (active ? (active.links.has(key) ? 0.55 : 0.07) : 0.26);

  return (
    <div
      ref={wrapRef}
      className="relative overflow-x-auto rounded-lg bg-black/20"
      onPointerLeave={() => {
        setHovered(null);
        setTip(null);
      }}
    >
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className={`h-auto w-full ${href ? "cursor-pointer" : ""} ${compact ? "min-w-[620px]" : "min-w-[820px]"}`}
        role="img"
        aria-label={`Flow of ${formatNumber(graph.totalSessions)} sessions across ${graph.steps} steps`}
        onClick={() => (href ? router.push(href) : setPinned(null))}
      >
        <defs>
        </defs>

        {/* Column headers */}
        {Array.from({ length: graph.steps }, (_, i) => {
          const sample = layout.nodes.find((n) => n.step === i + 1);
          if (!sample) return null;
          return (
            <text
              key={i}
              x={sample.x + layout.nodeWidth / 2}
              y={14}
              textAnchor="middle"
              className="fill-zinc-600"
              style={{ fontSize: 12 }}
            >
              {i === 0 ? "Entry" : `Step ${i + 1}`}
            </text>
          );
        })}

        {/* Ribbons first, so nodes and labels sit on top */}
        <g fill="none">
          {layout.links.map((link) => (
            <path
              key={link.key}
              ref={(el) => {
                if (el) pathRefs.current.set(link.key, el);
                else pathRefs.current.delete(link.key);
              }}
              d={link.d}
              stroke={link.color}
              strokeWidth={link.width}
              opacity={linkOpacity(link.key)}
              style={{ transition: "opacity 160ms ease" }}
              onPointerMove={(e) => showLink(e, link)}
              onPointerLeave={() => setTip(null)}
            />
          ))}
        </g>

        {/* Replay dots */}
        <g pointerEvents="none">
          {[0, 1, 2, 3].map((i) => (
            <g
              key={i}
              ref={(el) => {
                dotRefs.current[i] = el;
              }}
              opacity={0}
            >
              <circle r={8} fill="currentColor" opacity={0.2} />
              <circle r={3.5} fill="currentColor" stroke="#0f0f0f" strokeWidth={1} />
            </g>
          ))}
        </g>

        {/* Percent on the wide ribbons */}
        {(compact ? [] : layout.links)
          .filter((l) => l.width >= 16)
          .map((link) => {
            const s = nodeById.get(link.source)!;
            const t = nodeById.get(link.target)!;
            const x = (s.x + layout.nodeWidth + t.x) / 2;
            const y = (s.y + s.h / 2 + t.y + t.h / 2) / 2;
            return (
              <text
                key={`l-${link.key}`}
                x={x}
                y={y + 3}
                textAnchor="middle"
                className="pointer-events-none fill-zinc-200"
                opacity={active ? (active.links.has(link.key) ? 0.9 : 0.15) : 0.55}
                style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              >
                {pct(link.sessions, s.sessions)}
              </text>
            );
          })}

        {layout.nodes.map((node) => {
          const last = node.step === graph.steps;
          const isPinned = pinned === node.id;
          return (
            <g
              key={node.id}
              opacity={nodeOpacity(node.id)}
              style={{ transition: "opacity 160ms ease", cursor: href || node.kind !== "exit" ? "pointer" : "default" }}
              onPointerEnter={(e) => showNode(e, node)}
              onPointerMove={(e) => showNode(e, node)}
              onClick={(e) => {
                if (href) return; // bubbles to the svg, which navigates
                e.stopPropagation();
                if (node.kind !== "exit") setPinned((cur) => (cur === node.id ? null : node.id));
              }}
            >
              {/* Generous hit area: thin nodes are hard to land on */}
              <rect x={node.x - 6} y={node.y - 26} width={layout.nodeWidth + 12} height={node.h + 26} fill="transparent" />
              <rect
                x={node.x}
                y={node.y}
                width={layout.nodeWidth}
                height={node.h}
                rx={3}
                fill={node.color}
               
                stroke={isPinned ? "#fff" : "none"}
                strokeWidth={isPinned ? 1.5 : 0}
              />
              <text
                x={last ? node.x + layout.nodeWidth : node.x}
                y={node.y - 15}
                textAnchor={last ? "end" : "start"}
                className="pointer-events-none fill-zinc-400"
                style={{ fontSize: 10, fontFamily: "var(--font-mono), monospace" }}
              >
                {clip(labelOf(node), 22)}
              </text>
              <text
                x={last ? node.x + layout.nodeWidth : node.x}
                y={node.y - 4}
                textAnchor={last ? "end" : "start"}
                className="pointer-events-none fill-zinc-100"
                style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
              >
                {pct(node.sessions, graph.totalSessions)}
              </text>
            </g>
          );
        })}
      </svg>

      {routeSet && routeSet.order.length > 0 && (
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          aria-pressed={playing}
          className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-md border border-white/[0.1] bg-zinc-900/90 px-3 py-1 text-xs font-medium text-zinc-300 backdrop-blur transition-colors hover:border-white/[0.18] hover:text-white"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? "Pause" : "Replay route"}
        </button>
      )}

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 max-w-[260px] rounded-lg border border-white/[0.1] bg-zinc-900/95 px-3 py-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] backdrop-blur"
          style={{
            left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth ?? 600) - 240),
            top: Math.max(tip.y - 12, 4),
          }}
        >
          <p className="flex items-center gap-2 break-all font-mono text-xs font-medium text-zinc-100">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: tip.color }} />
            {tip.title}
          </p>
          {tip.lines.map((line) => (
            <p key={line} className="mt-0.5 text-xs tabular-nums text-zinc-400">
              {line}
            </p>
          ))}
        </div>
      )}

      {!compact && (
        <p className="px-3 pb-2 pt-1 text-xs text-zinc-600">
          {href ? "Hover a page to follow its flow. Click anywhere to open the full journey." : "Hover a page to follow its flow. Click to pin it, click the background to release."}
        </p>
      )}
    </div>
  );
}

export { EXIT as FLOW_EXIT_PAGE };
