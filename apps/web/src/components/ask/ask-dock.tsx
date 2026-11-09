"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ChevronDown, Clock, History, Plus, SlidersHorizontal, Sparkles } from "lucide-react";
import { PillTabs } from "@/components/motion/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { askContext } from "@/lib/ask/context";
import { answerFor } from "@/lib/ask/demo-engine";
import { initialState, reduce } from "@/lib/ask/state";
import { DEFAULT_SCOPE, RANGES, type AskScope, type PanelView, type PastQuestion } from "@/lib/ask/types";
import { TurnView } from "./answer-view";
import { AskConfigure } from "./ask-configure";

const EASE = [0.22, 1, 0.36, 1] as const;
/** A small pause after the last step, so the answer does not land in the same frame as the final tick. */
const SETTLE_MS = 220;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept this time; the dock still works.
  }
}

/** Keeps what a saved scope says only where it is still valid, so a site that was removed cannot linger in scope. */
function sanitize(saved: AskScope | null, base: AskScope, sites: string[]): AskScope {
  if (!saved) return base;
  const known = saved.siteDomains.filter((d) => sites.includes(d));
  return { ...base, ...saved, workspaceSlug: base.workspaceSlug, siteDomains: known.length > 0 ? known : base.siteDomains, sources: { ...base.sources, ...saved.sources } };
}

/**
 * Ask, the assistant that lives in the app. It is a floating bar at the bottom of every page, never a separate window: focus it
 * and it unfolds upward in place, with the page still usable behind it; fold it and it is a bar again. Answers are findings, not
 * chat bubbles: the steps the agent took, the answer with numbered citations, and the evidence (source, exact query, rows) behind
 * each number. What it may read and how is set under Configure and is always visible in the header.
 */
export function AskDock({ workspaceSlug, siteDomain, sites }: { workspaceSlug: string; siteDomain: string | null; sites: string[] }) {
  const pathname = usePathname();
  const ctx = React.useMemo(() => askContext(pathname, workspaceSlug), [pathname, workspaceSlug]);
  const base = React.useMemo(() => DEFAULT_SCOPE(workspaceSlug, siteDomain), [workspaceSlug, siteDomain]);
  const [state, dispatch] = React.useReducer(reduce, base, initialState);
  const timers = React.useRef<number[]>([]);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const scopeKey = `trackme_ask_scope:${workspaceSlug}`;
  const historyKey = `trackme_ask_history:${workspaceSlug}`;

  // What was saved last time.
  React.useEffect(() => {
    dispatch({ type: "load", scope: sanitize(read<AskScope>(scopeKey), base, sites), history: read<PastQuestion[]>(historyKey) ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  React.useEffect(() => {
    if (state.history.length > 0) write(historyKey, state.history);
  }, [state.history, historyKey]);

  const changeScope = React.useCallback(
    (scope: AskScope) => {
      dispatch({ type: "scope", scope });
      write(scopeKey, scope);
    },
    [scopeKey]
  );

  React.useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const siteBase = `/${workspaceSlug}${state.scope.siteDomains[0] ? `/sites/${state.scope.siteDomains[0]}` : ""}`;

  const ask = React.useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      dispatch({ type: "ask", id, question: q, page: ctx.page ?? "Ask", at: new Date().toISOString() });
      const answer = answerFor(q, state.scope, siteBase);
      // A real run streams its steps as it works; the preview reveals each one after the time it says it took.
      let at = 250;
      for (const step of answer.steps) {
        timers.current.push(window.setTimeout(() => dispatch({ type: "step", id }), at));
        at += step.ms;
      }
      timers.current.push(window.setTimeout(() => dispatch({ type: "answer", id, answer }), at + SETTLE_MS));
    },
    [ctx.page, state.scope, siteBase]
  );

  // Keyboard: "/" asks from anywhere (except while typing), Escape folds.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dispatch({ type: "open", view: "ask" });
        input.current?.focus();
      } else if (e.key === "Escape" && state.open && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        dispatch({ type: "fold" });
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open]);

  // A new question starts at its own top; progress inside a run keeps the newest step in view.
  const turnCount = state.turns.length;
  React.useEffect(() => {
    if (turnCount === 0) return;
    const last = state.turns[turnCount - 1]!;
    requestAnimationFrame(() => document.getElementById(`turn-${last.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnCount]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    ask(state.draft);
  };

  const lastQuestion = state.history[0]?.question;
  const thinking = state.turns.some((t) => t.status === "thinking");
  const rangeLabel = RANGES.find((r) => r.id === state.scope.range)?.label ?? "";
  const sourcesOn = Object.values(state.scope.sources).filter(Boolean).length;
  const site = state.scope.siteDomains[0] ?? "no website";
  const more = state.scope.siteDomains.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4" data-ask-dock="">
      <motion.section
        aria-label="Ask"
        className="pointer-events-auto flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-float"
        initial={false}
        animate={{ width: state.open ? 760 : 520 }}
        style={{ maxWidth: "100%" }}
        transition={{ type: "spring", bounce: 0, visualDuration: 0.34 }}
      >
        <AnimatePresence initial={false}>
          {state.open && (
            <motion.div key="panel" className="flex min-h-0 flex-col" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: EASE }} style={{ overflow: "hidden" }}>
              <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
                  <span className="shrink-0 text-zinc-500">Looking at</span>
                  <span className="truncate text-zinc-200">
                    {ctx.page ? `${ctx.page} · ` : ""}
                    {site}
                    {more > 0 ? ` +${more}` : ""} · {rangeLabel.toLowerCase()} · {sourcesOn} {sourcesOn === 1 ? "source" : "sources"}
                  </span>
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-zinc-500" title="The agent is not connected yet. Answers come from the demo dataset, and each one shows its queries.">
                    Preview
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PillTabs
                    kind="tabs"
                    size="sm"
                    label="Ask view"
                    value={state.view}
                    onChange={(view: PanelView) => dispatch({ type: "view", view })}
                    className="[&>button]:px-2"
                    items={[
                      { id: "ask", label: "Ask" },
                      { id: "history", label: <span className="inline-flex items-center gap-1"><History className="size-3" aria-hidden="true" />History</span> },
                      { id: "configure", label: <span className="inline-flex items-center gap-1"><SlidersHorizontal className="size-3" aria-hidden="true" />Configure</span> },
                    ]}
                  />
                  <Tooltip content="New conversation">
                    <button type="button" onClick={() => dispatch({ type: "clear" })} disabled={state.turns.length === 0} aria-label="New conversation" className="press grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30">
                      <Plus className="size-4" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Fold (Esc)">
                    <button type="button" onClick={() => dispatch({ type: "fold" })} aria-label="Fold" className="press grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100">
                      <ChevronDown className="size-4" />
                    </button>
                  </Tooltip>
                </div>
              </header>

              <div ref={body} className="min-h-0 overflow-y-auto px-4 py-4" style={{ maxHeight: "min(56vh, 540px)" }}>
                {state.view === "ask" && (
                  <>
                    {state.turns.length === 0 ? (
                      <div className="flex flex-col gap-4">
                        <div>
                          <p className="text-sm text-zinc-100">Ask about your data</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">Every number comes with the source and the exact query behind it, so you can check it.</p>
                        </div>
                        <ul className="flex flex-col">
                          {ctx.suggestions.map((s) => (
                            <li key={s}>
                              <button type="button" onClick={() => ask(s)} className="press flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/[0.04] hover:text-zinc-50">
                                {s}
                                <ArrowUp className="size-3.5 shrink-0 rotate-45 text-zinc-600" aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs leading-5 text-zinc-500">
                          Reading {sourcesOn} {sourcesOn === 1 ? "source" : "sources"}, read only. Change what I can read under <button type="button" onClick={() => dispatch({ type: "view", view: "configure" })} className="text-zinc-300 underline underline-offset-4">Configure</button>.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-6">
                        {state.turns.map((t) => (
                          <div key={t.id} id={`turn-${t.id}`} className="scroll-mt-1">
                            <TurnView turn={t} onFollow={ask} />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {state.view === "history" && (
                  <div>
                    {state.history.length === 0 ? (
                      <p className="py-8 text-center text-xs text-zinc-500">Questions you ask appear here.</p>
                    ) : (
                      <ul className="flex flex-col">
                        {state.history.map((h) => (
                          <li key={h.id}>
                            <button type="button" onClick={() => ask(h.question)} className="press flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-white/[0.04]">
                              <Clock className="mt-0.5 size-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-zinc-300">{h.question}</span>
                                <span className="block text-xs text-zinc-600">
                                  {h.page} · {new Date(h.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {state.view === "configure" && <AskConfigure scope={state.scope} sites={sites} onChange={changeScope} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={submit} className={cn("flex items-end gap-2 px-3 py-2.5", state.open && "border-t border-white/[0.06]")}>
          <Tooltip content="What I can read" side="top">
            <button type="button" onClick={() => dispatch({ type: "view", view: "configure" })} aria-label="Configure what Ask can read" className="press mb-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100">
              <SlidersHorizontal className="size-4" />
            </button>
          </Tooltip>
          <div className="relative min-w-0 flex-1">
            <label htmlFor="ask-input" className="sr-only">
              Ask about your data
            </label>
            <textarea
              id="ask-input"
              ref={input}
              rows={Math.min(4, Math.max(1, state.draft.split("\n").length))}
              value={state.draft}
              onChange={(e) => dispatch({ type: "draft", text: e.target.value })}
              onFocus={() => dispatch({ type: "open" })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "ArrowUp" && state.draft === "" && lastQuestion) {
                  e.preventDefault();
                  dispatch({ type: "draft", text: lastQuestion });
                }
              }}
              placeholder={thinking ? "Working on it…" : "Ask about your data"}
              className="block max-h-28 w-full resize-none bg-transparent py-2 text-sm leading-5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>
          {!state.open && state.unseen && (
            <span className="mb-2.5 inline-flex shrink-0 items-center gap-1.5 text-xs text-[#4cc38a]" role="status">
              <span className="size-1.5 rounded-full bg-[#4cc38a]" aria-hidden="true" /> Answer ready
            </span>
          )}
          {!state.open && !state.unseen && state.draft === "" && (
            <span className="mb-2 hidden shrink-0 sm:block">
              <Kbd>/</Kbd>
            </span>
          )}
          <button
            type="submit"
            disabled={!state.draft.trim()}
            aria-label="Ask"
            className={cn("press mb-0.5 grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-150", state.draft.trim() ? "bg-[#ededed] text-[#141415] hover:bg-white" : "bg-white/[0.06] text-zinc-600")}
          >
            {state.draft.trim() ? <ArrowUp className="size-4" /> : <Sparkles className="size-4" />}
          </button>
        </form>

        {state.open && (
          <p className="flex items-center justify-between gap-3 border-t border-white/[0.04] px-4 py-1.5 text-[11px] text-zinc-600">
            <span className="flex items-center gap-3">
              <span><Kbd>Enter</Kbd> ask</span>
              <span><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line</span>
              <span><Kbd>↑</Kbd> last question</span>
            </span>
            <span><Kbd>Esc</Kbd> fold</span>
          </p>
        )}
      </motion.section>
    </div>
  );
}
