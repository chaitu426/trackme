"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, ChevronRight, Lightbulb, Pencil } from "lucide-react";
import { MatrixSpinner } from "@/components/ui/matrix-loader";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Answer, Block, EvidenceItem, Step, Turn } from "@/lib/ask/types";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ───────────────────────────── citations ───────────────────────────── */

/** A small numbered mark after a claim. Clicking it opens the evidence behind the claim. */
function Cite({ n, onOpen }: { n: number; onOpen: (n: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      aria-label={`Show evidence ${n}`}
      className="press mx-0.5 inline-grid h-4 min-w-4 -translate-y-0.5 place-items-center rounded border border-border bg-white/[0.05] px-1 align-middle font-mono text-[10px] leading-none text-zinc-300 hover:border-white/[0.24] hover:text-zinc-50"
    >
      {n}
    </button>
  );
}

/** Text with `[n]` turned into citation marks. Anything else is plain text; nothing here is ever treated as markup. */
function CitedText({ text, onOpen }: { text: string; onOpen: (n: number) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        return m ? <Cite key={i} n={Number(m[1])} onOpen={onOpen} /> : <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

/* ───────────────────────────── blocks ───────────────────────────── */

function BlockView({ block, onOpen }: { block: Block; onOpen: (n: number) => void }) {
  switch (block.type) {
    case "text":
      return (
        <p className="text-sm leading-6 text-zinc-200">
          <CitedText text={block.text} onOpen={onOpen} />
        </p>
      );
    case "stats":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          {block.items.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-white/[0.02] px-3 py-2.5">
              <p className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                <span className="truncate">{s.label}</span>
                {s.cite && <Cite n={s.cite} onOpen={onOpen} />}
              </p>
              <p className={cn("mt-1 font-mono text-lg tabular-nums", s.tone === "down" ? "text-[#e5484d]" : "text-zinc-50")}>{s.value}</p>
              {s.delta && <p className={cn("font-mono text-xs tabular-nums", s.tone === "up" ? "text-[#4cc38a]" : "text-zinc-500")}>{s.delta}</p>}
            </div>
          ))}
        </div>
      );
    case "bars": {
      const max = Math.max(...block.rows.map((r) => r.value), 1);
      return (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">{block.title}</p>
          <ul className="flex flex-col gap-2">
            {block.rows.map((r, i) => (
              <li key={r.label}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-300">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums text-zinc-50">
                    {r.display}
                    {r.cite && <Cite n={r.cite} onOpen={onOpen} />}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/[0.06]" aria-hidden="true">
                  <div className={cn("grow-x h-1 rounded-full", i === 0 ? "bg-zinc-100" : "bg-zinc-500")} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, ["--i" as string]: i }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "table":
      return (
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-medium text-zinc-400">
            {block.title}
            {block.cite && <Cite n={block.cite} onOpen={onOpen} />}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.02] text-zinc-500">
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={c} className={cn("px-3 py-2 font-normal", i === 0 ? "text-left" : "text-right")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-white/[0.05]">
                    {r.map((c, i) => (
                      <td key={i} className={cn("px-3 py-2", i === 0 ? "max-w-[260px] truncate text-left text-zinc-200" : "text-right font-mono tabular-nums text-zinc-300")}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "spark": {
      const w = 320, h = 44;
      const min = Math.min(...block.points), max = Math.max(...block.points);
      const pts = block.points.map((v, i) => `${(i / Math.max(block.points.length - 1, 1)) * w},${h - 4 - ((v - min) / Math.max(max - min, 1)) * (h - 8)}`).join(" ");
      return (
        <div>
          <p className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-400">
            <span className="flex items-center gap-1">
              {block.title}
              {block.cite && <Cite n={block.cite} onOpen={onOpen} />}
            </span>
            <span className="font-mono text-zinc-500">{block.display}</span>
          </p>
          <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-full" role="img" aria-label={`${block.title}: ${block.display}`} preserveAspectRatio="none">
            <polyline points={pts} fill="none" stroke="#ededed" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="draw-line" />
          </svg>
        </div>
      );
    }
    case "callout":
      return (
        <p className={cn("rounded-lg border px-3 py-2 text-xs leading-5", block.tone === "warn" ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-200" : "border-border bg-white/[0.02] text-zinc-400")}>
          <CitedText text={block.text} onOpen={onOpen} />
        </p>
      );
  }
}

/* ───────────────────────────── evidence ───────────────────────────── */

const SOURCE_LABEL: Record<string, string> = { traffic: "Traffic", errors: "Errors", payments: "Payments", releases: "Releases", people: "People" };

function EvidenceCard({ item, open, onToggle }: { item: EvidenceItem; open: boolean; onToggle: () => void }) {
  return (
    <li id={`evidence-${item.n}`} className="rounded-lg border border-border bg-white/[0.02]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="press flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded border border-border bg-white/[0.05] px-1 font-mono text-[11px] text-zinc-300">{item.n}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-zinc-200">{item.title}</span>
          <span className="block truncate font-mono text-[11px] text-zinc-500">
            {SOURCE_LABEL[item.source]} · {item.table} · {item.rows.toLocaleString()} rows · {item.ms} ms
          </span>
        </span>
        <ChevronRight className={cn("size-4 shrink-0 text-zinc-500 transition-transform duration-150", open && "rotate-90")} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} style={{ overflow: "hidden" }}>
            <div className="flex flex-col gap-3 border-t border-white/[0.06] px-3 py-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">Query · {item.range}</span>
                  <CopyButton text={item.query} label="Copy" variant="ghost" className="h-6 px-2 text-[11px]" />
                </div>
                <pre className="overflow-x-auto rounded-md border border-border bg-black/30 p-3 font-mono text-[11px] leading-5 text-zinc-300">{item.query}</pre>
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-white/[0.02] text-zinc-500">
                    <tr>
                      {item.columns.map((c, i) => (
                        <th key={c} className={cn("px-2.5 py-1.5 font-normal", i === 0 ? "text-left" : "text-right")}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.sample.map((r, ri) => (
                      <tr key={ri} className="border-t border-white/[0.05]">
                        {r.map((c, i) => (
                          <td key={i} className={cn("px-2.5 py-1.5 font-mono tabular-nums", i === 0 ? "text-left text-zinc-300" : "text-right text-zinc-400")}>
                            {typeof c === "number" ? c.toLocaleString() : c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-zinc-500">Showing {item.sample.length} of {item.rows.toLocaleString()} rows.</p>
              {item.note && <p className="text-xs leading-5 text-zinc-400">{item.note}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {item.openHref && (
                  <Link href={item.openHref} className="press inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-zinc-300 hover:border-white/[0.2] hover:text-zinc-50">
                    Open the page <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
                <Tooltip content="Edit and re-run this query. Arrives with the query builder.">
                  <button type="button" disabled className="inline-flex h-7 cursor-not-allowed items-center gap-1 rounded-md border border-border px-2.5 text-xs text-zinc-600">
                    <Pencil className="size-3.5" aria-hidden="true" /> Edit query
                  </button>
                </Tooltip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/* ───────────────────────────── steps ───────────────────────────── */

/** What the agent is doing. Live while it works (the current step has the matrix mark), then folded to one honest summary line. */
function Steps({ steps, shown, done, evidenceCount }: { steps: Step[]; shown: number; done: boolean; evidenceCount: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const total = steps.reduce((s, x) => s + x.ms, 0);
  const visible = steps.slice(0, Math.max(shown, done ? steps.length : 0));
  const showList = !done || expanded;
  return (
    <div>
      {done && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="press flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-90")} aria-hidden="true" />
          {steps.length} steps · {evidenceCount} {evidenceCount === 1 ? "query" : "queries"} · {(total / 1000).toFixed(1)} s
        </button>
      )}
      <AnimatePresence initial={false}>
        {showList && (
          <motion.ol initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: "hidden" }} className="flex flex-col gap-1.5 pt-1.5">
            {visible.map((s, i) => {
              const current = !done && i === visible.length - 1;
              return (
                <motion.li key={s.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-zinc-400">{current ? <MatrixSpinner /> : <Check className="size-3.5 text-[#4cc38a]" aria-hidden="true" />}</span>
                  <span className="min-w-0">
                    <span className={current ? "text-zinc-200" : "text-zinc-400"}>{s.label}</span>
                    {s.detail && <span className="ml-2 font-mono text-[11px] text-zinc-600">{s.detail}</span>}
                  </span>
                </motion.li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────────── a turn ───────────────────────────── */

export function TurnView({ turn, onFollow }: { turn: Turn; onFollow: (question: string) => void }) {
  const a: Answer | undefined = turn.answer;
  const [openEvidence, setOpenEvidence] = React.useState<Set<number>>(new Set());
  const [showAssumptions, setShowAssumptions] = React.useState(false);

  const openOne = React.useCallback((n: number) => {
    setOpenEvidence((s) => new Set(s).add(n));
    // The evidence list is below the answer; bring the opened item into view.
    requestAnimationFrame(() => document.getElementById(`evidence-${n}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, []);
  const toggle = (n: number) =>
    setOpenEvidence((s) => {
      const next = new Set(s);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  return (
    <article className="flex flex-col gap-3" aria-busy={turn.status === "thinking"}>
      <h3 className="text-sm font-medium text-zinc-50">{turn.question}</h3>

      {a ? <Steps steps={a.steps} shown={turn.shownSteps} done={turn.status === "done"} evidenceCount={a.evidence.length} /> : null}

      {turn.status === "done" && a && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }} className="flex flex-col gap-3">
          {a.blocks.map((b, i) => (
            <BlockView key={i} block={b} onOpen={openOne} />
          ))}

          {a.limit && <p className="rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-xs leading-5 text-zinc-400">{a.limit}</p>}

          {a.evidence.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-400">Evidence</p>
              <ul className="flex flex-col gap-1.5">
                {a.evidence.map((e) => (
                  <EvidenceCard key={e.n} item={e} open={openEvidence.has(e.n)} onToggle={() => toggle(e.n)} />
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", a.confidence === "high" ? "bg-[#4cc38a]" : a.confidence === "medium" ? "bg-amber-400" : "bg-zinc-500")} aria-hidden="true" />
              {a.confidence === "high" ? "High confidence" : a.confidence === "medium" ? "Medium confidence" : "Low confidence"}
            </span>
            {a.assumptions.length > 0 && (
              <button type="button" onClick={() => setShowAssumptions((v) => !v)} aria-expanded={showAssumptions} className="press hover:text-zinc-300">
                {a.assumptions.length} {a.assumptions.length === 1 ? "assumption" : "assumptions"}
              </button>
            )}
          </div>
          {showAssumptions && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-5 text-zinc-400 marker:text-zinc-600">
              {a.assumptions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}

          {a.ideas.length > 0 && (
            <div className="rounded-lg border border-border bg-white/[0.02] p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                <Lightbulb className="size-3.5" aria-hidden="true" /> What you could do next
              </p>
              <ul className="flex flex-col gap-2">
                {a.ideas.map((i) => (
                  <li key={i.title} className="text-xs leading-5">
                    <span className="text-zinc-200">{i.title}.</span> <span className="text-zinc-400">{i.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.followups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {a.followups.map((f) => (
                <button key={f} type="button" onClick={() => onFollow(f)} className="press rounded-full border border-border px-3 py-1 text-xs text-zinc-300 hover:border-white/[0.2] hover:text-zinc-50">
                  {f}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </article>
  );
}
