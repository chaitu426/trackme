"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { ArrowUpRight, Check, ChevronRight, Pencil } from "lucide-react";
import { GlyphCaret, MatrixSpinner } from "@/components/ui/matrix-loader";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Answer, Block, EvidenceItem, Step, Turn } from "@/lib/ask/types";

const EASE = [0.22, 1, 0.36, 1] as const;
/** The whole answer text takes about this long to write, however long it is, so a long answer never feels slow. */
const TYPE_TOTAL_MS = 1800;

/* ───────────────────────────── citations ───────────────────────────── */

/** A tiny numbered mark after a claim. Opens the evidence behind it. */
function Cite({ n, onOpen }: { n: number; onOpen: (n: number) => void }) {
  return (
    <button type="button" onClick={() => onOpen(n)} aria-label={`Show evidence ${n}`} className="press mx-0.5 inline-grid h-[15px] min-w-[15px] -translate-y-px place-items-center rounded-full bg-white/[0.08] px-1 align-middle font-mono text-[9px] leading-none text-zinc-300 hover:bg-white/[0.16] hover:text-zinc-50">
      {n}
    </button>
  );
}

const WORD = /(\s+)/;

/**
 * The answer, written out word by word with a glyph caret at the end while it is being written, then the caret goes. Citations
 * appear as soon as their word does. With reduced motion, or for an answer already read, it is all there at once. Plain text only:
 * nothing in an answer is ever treated as markup.
 */
function WrittenText({ text, onOpen, write, onDone }: { text: string; onOpen: (n: number) => void; write: boolean; onDone: () => void }) {
  const reduce = useReducedMotion();
  const tokens = React.useMemo(() => text.split(WORD).filter((t) => t !== ""), [text]);
  const words = tokens.filter((t) => !/^\s+$/.test(t)).length;
  const [shown, setShown] = React.useState(write && !reduce ? 0 : tokens.length);
  const done = React.useRef(false);
  const finish = React.useRef(onDone);
  finish.current = onDone;

  React.useEffect(() => {
    if (!write || reduce) {
      if (!done.current) {
        done.current = true;
        finish.current();
      }
      return;
    }
    const step = Math.max(10, Math.min(45, TYPE_TOTAL_MS / Math.max(words, 1)));
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n >= tokens.length) {
          window.clearInterval(timer);
          if (!done.current) {
            done.current = true;
            window.setTimeout(() => finish.current(), 120);
          }
          return n;
        }
        return n + 1;
      });
    }, step);
    return () => window.clearInterval(timer);
  }, [write, reduce, words, tokens.length]);

  const typing = shown < tokens.length;
  return (
    <p className="text-[15px] leading-7 text-zinc-100">
      {tokens.slice(0, shown).map((t, i) => {
        const m = /^\[(\d+)\]$/.exec(t);
        return m ? <Cite key={i} n={Number(m[1])} onOpen={onOpen} /> : <React.Fragment key={i}>{t}</React.Fragment>;
      })}
      {typing && <GlyphCaret />}
    </p>
  );
}

/** Text that is not being written out: a note or a callout, with its citations. */
function CitedText({ text, onOpen }: { text: string; onOpen: (n: number) => void }) {
  return (
    <>
      {text.split(/(\[\d+\])/g).map((p, i) => {
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
        <p className="text-sm leading-6 text-zinc-300">
          <CitedText text={block.text} onOpen={onOpen} />
        </p>
      );
    case "stats":
      return (
        <dl className="flex flex-wrap gap-x-9 gap-y-3">
          {block.items.map((s) => (
            <div key={s.label}>
              <dt className="flex items-center gap-1 text-xs text-zinc-500">
                {s.label}
                {s.cite && <Cite n={s.cite} onOpen={onOpen} />}
              </dt>
              <dd className="mt-0.5 flex items-baseline gap-2">
                <span className={cn("font-mono text-xl tabular-nums", s.tone === "down" ? "text-[#e5484d]" : "text-zinc-50")}>{s.value}</span>
                {s.delta && <span className={cn("font-mono text-xs tabular-nums", s.tone === "up" ? "text-[#4cc38a]" : "text-zinc-500")}>{s.delta}</span>}
              </dd>
            </div>
          ))}
        </dl>
      );
    case "bars": {
      const max = Math.max(...block.rows.map((r) => r.value), 1);
      return (
        <div>
          <p className="mb-2.5 text-xs text-zinc-500">{block.title}</p>
          <ul className="flex flex-col gap-2.5">
            {block.rows.map((r, i) => (
              <li key={r.label}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate text-zinc-300">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-zinc-100">
                    {r.display}
                    {r.cite && <Cite n={r.cite} onOpen={onOpen} />}
                  </span>
                </div>
                <div className="mt-1.5 h-px bg-white/[0.08]" aria-hidden="true">
                  <div className={cn("grow-x h-px", i === 0 ? "bg-zinc-200" : "bg-zinc-500")} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, ["--i" as string]: i }} />
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
          <p className="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
            {block.title}
            {block.cite && <Cite n={block.cite} onOpen={onOpen} />}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-xs text-zinc-500">
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={c} className={cn("py-1.5 font-normal", i === 0 ? "pr-3 text-left" : "px-2 text-right")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-white/[0.06]">
                    {r.map((c, i) => (
                      <td key={i} className={cn("py-2", i === 0 ? "max-w-[240px] truncate pr-3 text-left text-zinc-200" : "px-2 text-right font-mono text-xs tabular-nums text-zinc-300")}>
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
      const w = 320, h = 40;
      const min = Math.min(...block.points), max = Math.max(...block.points);
      const pts = block.points.map((v, i) => `${(i / Math.max(block.points.length - 1, 1)) * w},${h - 4 - ((v - min) / Math.max(max - min, 1)) * (h - 8)}`).join(" ");
      return (
        <div>
          <p className="mb-1 flex items-center justify-between text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              {block.title}
              {block.cite && <Cite n={block.cite} onOpen={onOpen} />}
            </span>
            <span className="font-mono">{block.display}</span>
          </p>
          <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" role="img" aria-label={`${block.title}: ${block.display}`} preserveAspectRatio="none">
            <polyline points={pts} fill="none" stroke="#ededed" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="draw-line" />
          </svg>
        </div>
      );
    }
    case "callout":
      return (
        <p className={cn("border-l-2 pl-3 text-xs leading-5", block.tone === "warn" ? "border-amber-400/60 text-amber-200/90" : "border-white/[0.14] text-zinc-400")}>
          <CitedText text={block.text} onOpen={onOpen} />
        </p>
      );
  }
}

/* ───────────────────────────── evidence ───────────────────────────── */

function EvidenceDetail({ item }: { item: EvidenceItem }) {
  return (
    <motion.div id={`evidence-${item.n}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: EASE }} style={{ overflow: "hidden" }}>
      <div className="flex flex-col gap-3 border-l border-white/[0.1] py-1 pl-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-400">
              <span className="font-mono text-zinc-200">{item.n}</span> · {item.title} · {item.range}
            </p>
            <CopyButton text={item.query} label="Copy query" variant="ghost" className="h-6 px-2 text-[11px]" />
          </div>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-5 text-zinc-300">{item.query}</pre>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-zinc-500">
              <tr>
                {item.columns.map((c, i) => (
                  <th key={c} className={cn("py-1 font-normal", i === 0 ? "pr-3 text-left" : "px-2 text-right")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.sample.map((r, ri) => (
                <tr key={ri} className="border-t border-white/[0.05]">
                  {r.map((c, i) => (
                    <td key={i} className={cn("py-1.5 font-mono tabular-nums", i === 0 ? "pr-3 text-left text-zinc-300" : "px-2 text-right text-zinc-400")}>
                      {typeof c === "number" ? c.toLocaleString() : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-zinc-600">
            {item.sample.length} of {item.rows.toLocaleString()} rows · {item.ms} ms · {item.table}
          </p>
        </div>
        {item.note && <p className="text-xs leading-5 text-zinc-400">{item.note}</p>}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {item.openHref && (
            <Link href={item.openHref} className="press inline-flex items-center gap-1 text-zinc-300 hover:text-zinc-50">
              Open the page <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
          <Tooltip content="Edit and re-run this query. Arrives with the query builder.">
            <span className="inline-flex cursor-not-allowed items-center gap-1 text-zinc-600">
              <Pencil className="size-3.5" aria-hidden="true" /> Edit query
            </span>
          </Tooltip>
        </div>
      </div>
    </motion.div>
  );
}

/* ───────────────────────────── live work ───────────────────────────── */

/** A number that counts up to its target while a tool call runs, so the call looks like it is reading rows. */
function RowCounter({ to, ms }: { to: number; ms: number }) {
  const reduce = useReducedMotion();
  const value = useMotionValue(reduce ? to : 0);
  const text = useTransform(value, (v) => Math.round(v).toLocaleString());
  React.useEffect(() => {
    if (reduce) return;
    const controls = animate(value, to, { duration: Math.max(0.3, ms / 1000 - 0.1), ease: "easeOut" });
    return () => controls.stop();
  }, [to, ms, reduce, value]);
  return <motion.span>{text}</motion.span>;
}

/**
 * The agent working, as one line that changes with what it is doing: a tool call shows the table being read and a row count
 * climbing to the result; other steps show their phrase. The steps already done are a row of small ticks, so progress is visible
 * without a list. The matrix mark is the "working" sign, the same one buttons and the logo use.
 */
function Working({ steps, shown }: { steps: Step[]; shown: number }) {
  const current = steps[Math.max(0, Math.min(shown, steps.length) - 1)];
  const finished = Math.max(0, shown - 1);
  return (
    <div className="flex items-center gap-3 text-xs" role="status" aria-live="polite">
      <span className="text-zinc-300">
        <MatrixSpinner />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={current?.id ?? "start"} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.16 }} className="flex min-w-0 items-center gap-2">
          <span className="truncate text-zinc-300">{current ? current.label : "Reading your question"}</span>
          {current?.tool && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-zinc-400">
              {current.tool.table}
              <span className="text-zinc-600">·</span>
              <span className="tabular-nums text-zinc-200">
                <RowCounter to={current.tool.rows} ms={current.ms} />
              </span>
              rows
            </span>
          )}
        </motion.div>
      </AnimatePresence>
      {steps.length > 0 && (
        <span className="ml-auto flex shrink-0 items-center gap-1" aria-label={`${finished} of ${steps.length} steps done`}>
          {steps.map((s, i) => (
            <span key={s.id} className={cn("size-1 rounded-full transition-colors duration-200", i < finished ? "bg-[#4cc38a]" : i === finished ? "bg-zinc-300" : "bg-white/[0.14]")} />
          ))}
        </span>
      )}
    </div>
  );
}

/* ───────────────────────────── a turn ───────────────────────────── */

export function TurnView({ turn, onFollow }: { turn: Turn; onFollow: (question: string) => void }) {
  const a: Answer | undefined = turn.answer;
  // An answer is written out only if this turn was watched from the moment it was asked. A turn mounted already finished is shown whole.
  const [fresh] = React.useState(turn.status === "thinking");
  const [settled, setSettled] = React.useState(!fresh);
  const [openEvidence, setOpenEvidence] = React.useState<Set<number>>(new Set());
  const [details, setDetails] = React.useState<"none" | "assumptions" | "steps">("none");

  const openOne = React.useCallback((n: number) => {
    setOpenEvidence((s) => new Set(s).add(n));
    requestAnimationFrame(() => document.getElementById(`evidence-${n}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, []);
  const toggle = (n: number) =>
    setOpenEvidence((s) => {
      const next = new Set(s);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  const first = a?.blocks[0];
  const writeFirst = fresh && first?.type === "text";
  const onWritten = React.useCallback(() => setSettled(true), []);
  // With nothing to write out, the rest is not held back.
  React.useEffect(() => {
    if (a && !writeFirst) setSettled(true);
  }, [a, writeFirst]);

  const total = a ? a.steps.reduce((s, x) => s + x.ms, 0) : 0;
  const rise = (i: number) => ({ initial: fresh ? { opacity: 0, y: 8 } : false, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: fresh ? i * 0.06 : 0, ease: EASE } }) as const;

  return (
    <article className="flex flex-col gap-2.5" aria-busy={turn.status === "thinking"}>
      <p className="glass w-fit max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2 text-[13px] leading-5 text-zinc-200">{turn.question}</p>

      <div className="glass flex flex-col gap-4 rounded-2xl px-5 py-4">
        {turn.status === "thinking" && a === undefined ? <Working steps={turn.pending ?? []} shown={turn.shownSteps} /> : null}
        {turn.status === "thinking" && a !== undefined ? <Working steps={a.steps} shown={turn.shownSteps} /> : null}

        {turn.status === "done" && a && (
          <>
            {first?.type === "text" ? <WrittenText text={first.text} onOpen={openOne} write={writeFirst} onDone={onWritten} /> : null}

            {settled && (
              <>
                {a.blocks.slice(first?.type === "text" ? 1 : 0).map((b, i) => (
                  <motion.div key={i} {...rise(i)}>
                    <BlockView block={b} onOpen={openOne} />
                  </motion.div>
                ))}

                {a.limit && <motion.p {...rise(a.blocks.length)} className="border-l-2 border-white/[0.14] pl-3 text-xs leading-5 text-zinc-400">{a.limit}</motion.p>}

                {a.evidence.length > 0 && (
                  <motion.div {...rise(a.blocks.length + 1)} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-xs text-zinc-500">Sources</span>
                      {a.evidence.map((e) => (
                        <button
                          key={e.n}
                          type="button"
                          onClick={() => toggle(e.n)}
                          aria-expanded={openEvidence.has(e.n)}
                          className={cn("press inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors duration-150", openEvidence.has(e.n) ? "bg-white/[0.14] text-zinc-50" : "bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-200")}
                        >
                          <span className="text-zinc-200">{e.n}</span>
                          {e.table.split(" ")[0]}
                          <span className="text-zinc-600">{e.ms} ms</span>
                          <ChevronRight className={cn("size-3 transition-transform duration-150", openEvidence.has(e.n) && "rotate-90")} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    <AnimatePresence initial={false}>
                      {a.evidence.filter((e) => openEvidence.has(e.n)).map((e) => (
                        <EvidenceDetail key={e.n} item={e} />
                      ))}
                    </AnimatePresence>
                  </motion.div>
                )}

                <motion.div {...rise(a.blocks.length + 2)} className="flex flex-col gap-2">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-1.5 rounded-full", a.confidence === "high" ? "bg-[#4cc38a]" : a.confidence === "medium" ? "bg-amber-400" : "bg-zinc-500")} aria-hidden="true" />
                      {a.confidence === "high" ? "High" : a.confidence === "medium" ? "Medium" : "Low"} confidence
                    </span>
                    {a.assumptions.length > 0 && (
                      <button type="button" onClick={() => setDetails((d) => (d === "assumptions" ? "none" : "assumptions"))} aria-expanded={details === "assumptions"} className="press hover:text-zinc-300">
                        {a.assumptions.length} {a.assumptions.length === 1 ? "assumption" : "assumptions"}
                      </button>
                    )}
                    <button type="button" onClick={() => setDetails((d) => (d === "steps" ? "none" : "steps"))} aria-expanded={details === "steps"} className="press hover:text-zinc-300">
                      {a.steps.length} steps · {a.evidence.length} {a.evidence.length === 1 ? "query" : "queries"} · {(total / 1000).toFixed(1)} s
                    </button>
                  </p>
                  <AnimatePresence initial={false}>
                    {details === "assumptions" && (
                      <motion.ul key="assumptions" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: "hidden" }} className="flex list-disc flex-col gap-1 pl-5 text-xs leading-5 text-zinc-400 marker:text-zinc-600">
                        {a.assumptions.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </motion.ul>
                    )}
                    {details === "steps" && (
                      <motion.ol key="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} style={{ overflow: "hidden" }} className="flex flex-col gap-1.5">
                        {a.steps.map((s) => (
                          <li key={s.id} className="flex items-baseline gap-2 text-xs text-zinc-400">
                            <Check className="size-3 shrink-0 translate-y-0.5 text-[#4cc38a]" aria-hidden="true" />
                            <span>{s.label}</span>
                            {s.tool && <span className="font-mono text-[11px] text-zinc-600">{s.tool.table} · {s.tool.rows.toLocaleString()} rows</span>}
                          </li>
                        ))}
                      </motion.ol>
                    )}
                  </AnimatePresence>
                </motion.div>

                {a.ideas.length > 0 && (
                  <motion.div {...rise(a.blocks.length + 3)}>
                    <p className="mb-1.5 text-xs text-zinc-500">You could</p>
                    <ul className="flex flex-col gap-1.5">
                      {a.ideas.map((i) => (
                        <li key={i.title} className="text-[13px] leading-5">
                          <span className="text-zinc-200">{i.title}.</span> <span className="text-zinc-500">{i.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}

                {a.followups.length > 0 && (
                  <motion.div {...rise(a.blocks.length + 4)} className="flex flex-wrap gap-1.5">
                    {a.followups.map((f) => (
                      <button key={f} type="button" onClick={() => onFollow(f)} className="press rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-100">
                        {f}
                      </button>
                    ))}
                  </motion.div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}
