"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowUp, ChevronDown, History, Plus } from "lucide-react";
import { MatrixSpinner } from "@/components/ui/matrix-loader";
import { Tooltip } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { askContext } from "@/lib/ask/context";
import { startRun, streamRun } from "@/lib/ask/run-client";
import { initialState, reduce } from "@/lib/ask/state";
import { DEFAULT_SCOPE, RANGES, type AskScope, type PastQuestion } from "@/lib/ask/types";
import { TurnView } from "./answer-view";
import { AskConfigure } from "./ask-configure";

const EASE = [0.22, 1, 0.36, 1] as const;
const TIMEOUT_MS = 180_000;

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
  return { ...base, ...saved, workspaceSlug: base.workspaceSlug, siteDomains: known.length > 0 ? known : base.siteDomains, sources: { ...base.sources, ...saved.sources }, maxRows: Math.min(saved.maxRows ?? base.maxRows, base.maxRows) };
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
  const stops = React.useRef<Map<string, () => void>>(new Map());
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

  React.useEffect(
    () => () => {
      stops.current.forEach((stop) => stop());
    },
    []
  );

  const ask = React.useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      // A live run starts with no steps known: the worker publishes them as it reads, and they arrive over SSE.
      dispatch({ type: "ask", id, question: q, page: ctx.page ?? "Ask", at: new Date().toISOString() });

      const fail = (message: string) => {
        dispatch({ type: "fail", id, message });
        stops.current.delete(id);
      };
      const timeout = window.setTimeout(() => {
        stops.current.get(id)?.();
        fail("This took too long. Try again, or narrow the range.");
      }, TIMEOUT_MS);

      startRun(q, state.scope, ctx.page ?? undefined)
        .then(({ runId }) => {
          if (stops.current.get(id) === undefined) return;
          stops.current.set(
            id,
            streamRun(runId, {
              onStep: (step) => dispatch({ type: "pushStep", id, step }),
              onAnswer: (answer) => {
                window.clearTimeout(timeout);
                stops.current.delete(id);
                dispatch({ type: "answer", id, answer });
              },
              onError: (message) => {
                window.clearTimeout(timeout);
                fail(message);
              },
            })
          );
        })
        .catch((err: unknown) => {
          window.clearTimeout(timeout);
          stops.current.delete(id);
          fail(err instanceof Error ? err.message : "Ask could not start. Try again.");
        });

      // Mark the turn as live so a stop can be found, even before the POST returns.
      stops.current.set(id, () => window.clearTimeout(timeout));
    },
    [ctx.page, state.scope]
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


  const iconBtn = "press grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors duration-150 hover:bg-white/[0.08] hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent";
  const hasDraft = state.draft.trim() !== "";
  const sheet = state.view !== "ask";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4" data-ask-dock="">
      <motion.section aria-label="Ask" className="flex max-h-[calc(100vh-6rem)] flex-col gap-2" initial={false} animate={{ width: state.open ? 720 : 560 }} style={{ maxWidth: "100%" }} transition={{ type: "spring", bounce: 0, visualDuration: 0.34 }}>
        <AnimatePresence initial={false}>
          {state.open && (
            <motion.div key="panel" className="pointer-events-none flex min-h-0 flex-col" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.24, ease: EASE }}>
              <div
                ref={body}
                className="pointer-events-auto min-h-0 overflow-y-auto px-1 pb-1 pt-8"
                style={{ maxHeight: "min(62vh, 620px)" }}
              >
                {state.view === "ask" &&
                  (state.turns.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 pb-1 text-center">
                      <p className="text-sm text-zinc-300">Ask about your data</p>
                      <ul className="flex flex-wrap justify-center gap-2">
                        {ctx.suggestions.map((s) => (
                          <li key={s}>
                            <button type="button" onClick={() => ask(s)} className="press glass rounded-full px-3.5 py-2 text-[13px] text-zinc-300 hover:text-zinc-50">
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-7">
                      {state.turns.map((t) => (
                        <div key={t.id} id={`turn-${t.id}`} className="scroll-mt-1">
                          <TurnView turn={t} onFollow={ask} site={site} range={rangeLabel} />
                        </div>
                      ))}
                    </div>
                  ))}

                {sheet && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }} className="glass rounded-2xl p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <button type="button" onClick={() => dispatch({ type: "view", view: "ask" })} className="press inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100">
                        <ArrowLeft className="size-3.5" aria-hidden="true" /> Back
                      </button>
                      <p className="text-xs text-zinc-500">{state.view === "history" ? "History" : "What I can read"}</p>
                    </div>
                    {state.view === "history" &&
                      (state.history.length === 0 ? (
                        <p className="py-6 text-center text-xs text-zinc-500">Questions you ask appear here.</p>
                      ) : (
                        <ul className="flex flex-col">
                          {state.history.map((h) => (
                            <li key={h.id}>
                              <button type="button" onClick={() => ask(h.question)} className="press flex w-full items-baseline justify-between gap-4 rounded-lg px-2 py-2 text-left hover:bg-white/[0.05]">
                                <span className="truncate text-sm text-zinc-300">{h.question}</span>
                                <span className="shrink-0 text-[11px] text-zinc-600">
                                  {h.page} · {new Date(h.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ))}
                    {state.view === "configure" && <AskConfigure scope={state.scope} sites={sites} onChange={changeScope} />}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={submit} className="glass pointer-events-auto flex items-end gap-1 rounded-[26px] p-1.5">
          <Tooltip content={`${site}${more > 0 ? ` +${more}` : ""} · ${rangeLabel.toLowerCase()} · ${sourcesOn} ${sourcesOn === 1 ? "source" : "sources"}`} side="top">
            <button type="button" onClick={() => dispatch({ type: "view", view: "configure" })} aria-label="Configure what Ask can read" className="press mb-0 flex h-8 shrink-0 items-center rounded-full bg-white/[0.08] px-3.5 text-xs text-zinc-300 hover:bg-white/[0.1] hover:text-zinc-50">
              <span className="max-w-[110px] truncate">{ctx.page ?? "Ask"}</span>
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
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
              placeholder={thinking ? "Working on it" : "Ask about your data"}
              className="block max-h-28 w-full resize-none bg-transparent px-2 py-[7px] text-sm leading-[18px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>
          {state.open ? (
            <>
              <Tooltip content="History">
                <button type="button" onClick={() => dispatch({ type: "view", view: state.view === "history" ? "ask" : "history" })} aria-label="History" aria-pressed={state.view === "history"} className={iconBtn}>
                  <History className="size-4" />
                </button>
              </Tooltip>
              <Tooltip content="New conversation">
                <button type="button" onClick={() => dispatch({ type: "clear" })} disabled={state.turns.length === 0} aria-label="New conversation" className={iconBtn}>
                  <Plus className="size-4" />
                </button>
              </Tooltip>
              <Tooltip content="Fold (Esc)">
                <button type="button" onClick={() => dispatch({ type: "fold" })} aria-label="Fold" className={iconBtn}>
                  <ChevronDown className="size-4" />
                </button>
              </Tooltip>
            </>
          ) : state.unseen ? (
            <span className="mb-[7px] mr-2 inline-flex shrink-0 items-center gap-1.5 text-xs text-good" role="status">
              <span className="size-1.5 rounded-full bg-good" aria-hidden="true" /> Ready
            </span>
          ) : (
            !hasDraft && (
              <span className="mb-[7px] mr-1 hidden shrink-0 sm:block">
                <Kbd>/</Kbd>
              </span>
            )
          )}
          <button
            type="submit"
            disabled={!hasDraft || thinking}
            aria-label={thinking ? "Working" : "Ask"}
            className={cn("press grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-150", hasDraft && !thinking ? "bg-[#ededed] text-[#141415] hover:bg-white" : "bg-white/[0.06] text-zinc-500")}
          >
            {thinking ? <MatrixSpinner /> : <ArrowUp className="size-4" />}
          </button>
        </form>
      </motion.section>
    </div>
  );
}
