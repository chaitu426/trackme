"use client";

import * as React from "react";
import { Bug, IndianRupee, Rocket, Server, Users, Lock, RotateCcw, ArrowUp, type LucideIcon } from "lucide-react";
import { useInView } from "./motion";

/**
 * The money trail, as a demo you can run. Each tool alone knows one number and none of them knows what it cost. Ask a question and
 * the agent reads the tables (you see which, and how many rows), then draws the line from the cause to the rupees. The data is a
 * made-up store, and the page says so. Plays once when it scrolls into view, then on request.
 */

type Kind = "release" | "error" | "gateway" | "funnel" | "money";
const ICON: Record<Kind, LucideIcon> = { release: Rocket, error: Bug, gateway: Server, funnel: Users, money: IndianRupee };

interface Scenario {
  id: string;
  question: string;
  tools: Array<{ table: string; rows: number; label: string }>;
  trail: Array<{ kind: Kind; title: string; detail: string }>;
  total: number;
  caption: string;
  basis: string;
  sql: string;
  silos: Array<{ tool: string; knows: string }>;
}

const SCENARIOS: Scenario[] = [
  {
    id: "bug",
    question: "What is the checkout bug costing us?",
    tools: [
      { table: "events_v2", rows: 4724, label: "Finding errors in checkout sessions" },
      { table: "leak_sessions", rows: 624, label: "Comparing who paid with and without each" },
      { table: "payment_events", rows: 2016, label: "Valuing the gap at your average order" },
    ],
    trail: [
      { kind: "release", title: "Release 2.4.1 shipped", detail: "Tuesday, 11:20" },
      { kind: "error", title: "TypeError on the checkout page", detail: "cannot read properties of undefined" },
      { kind: "funnel", title: "113 sessions hit it", detail: "23% paid, against 69% without it" },
      { kind: "money", title: "That gap is the cost", detail: "Beyond normal drop-off, over 30 days" },
    ],
    total: 195970,
    caption: "lost to one error",
    basis: "Conversion gap × affected sessions × your average order. An estimate, and it says so.",
    sql: "SELECT g, count() AS sessions, countIf(paid) AS paid\nFROM leak_sessions FINAL\nARRAY JOIN error_groups AS g\nWHERE site_id = {siteId} AND day BETWEEN {from} AND {to}\nGROUP BY g ORDER BY sessions DESC",
    silos: [
      { tool: "Error tracker", knows: "TypeError, 1,204 events" },
      { tool: "Web analytics", knows: "Checkout conversion down 18%" },
      { tool: "Payment gateway", knows: "Success rate 95%" },
    ],
  },
  {
    id: "dip",
    question: "Why did payments dip yesterday?",
    tools: [
      { table: "payment_events", rows: 2016, label: "Reading gateway health in 5-minute buckets" },
      { table: "payment_failure_class", rows: 98, label: "Reading what the failures were" },
      { table: "payment_events", rows: 8, label: "Checking the other gateway" },
    ],
    trail: [
      { kind: "gateway", title: "Razorpay timed out, 14:00 to 14:40", detail: "Every payment failed with the same code" },
      { kind: "funnel", title: "26 customers hit it", detail: "Stripe in the same window was fine" },
      { kind: "money", title: "Their orders did not complete", detail: "Classified as the gateway’s own failure" },
    ],
    total: 176940,
    caption: "of orders failed to the gateway",
    basis: "Sum of failed order values classified as a gateway problem. Some customers may have paid later.",
    sql: "SELECT category, count() AS failures, sum(amount) AS value\nFROM payment_failure_class FINAL\nWHERE site_id = {siteId} AND created_at >= now() - INTERVAL 7 DAY\nGROUP BY category ORDER BY value DESC",
    silos: [
      { tool: "Payment gateway", knows: "A few failed payments" },
      { tool: "Error tracker", knows: "Nothing, it was not your code" },
      { tool: "Web analytics", knows: "A dip in purchases" },
    ],
  },
  {
    id: "release",
    question: "Is the new release hurting revenue?",
    tools: [
      { table: "site_releases", rows: 2, label: "Finding the release and the one before it" },
      { table: "events_v2", rows: 4724, label: "Comparing errors and conversion, 72 hours either side" },
      { table: "leak_sessions", rows: 624, label: "Valuing the difference" },
    ],
    trail: [
      { kind: "release", title: "Release 2.4.1 vs 2.4.0", detail: "72 hours either side" },
      { kind: "error", title: "One new error appeared", detail: "On 14% of checkout visits" },
      { kind: "funnel", title: "Checkout conversion fell", detail: "61% to 48%, past what chance explains" },
      { kind: "money", title: "At your order value", detail: "Per week, until fixed" },
    ],
    total: 82400,
    caption: "a week, from one release",
    basis: "Conversion change × weekly checkout sessions × your average order.",
    sql: "SELECT release, errors_per_session, conversion\nFROM release_compare\nWHERE site_id = {siteId} AND release IN ({this}, {previous})",
    silos: [
      { tool: "Deploy log", knows: "2.4.1 went out Tuesday" },
      { tool: "Error tracker", knows: "A new TypeError" },
      { tool: "Web analytics", knows: "Conversion moved" },
    ],
  },
];

const GLYPHS = [".", ":", "+", "#"];

function reduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The 3×3 working mark, the same one the app uses for "working". */
function Spinner() {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setT((n) => n + 1), 110);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="inline-grid grid-cols-3 gap-[2px]" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const level = (i + t) % 4;
        return <span key={i} className="size-[3px] rounded-[1px] bg-zinc-200" style={{ opacity: [0.15, 0.35, 0.65, 1][level] }} />;
      })}
    </span>
  );
}

function Caret() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setI((n) => n + 1), 130);
    return () => window.clearInterval(id);
  }, []);
  return <span aria-hidden="true" className="ml-0.5 inline-block w-[0.6em] font-mono text-zinc-300">{GLYPHS[i % 4]}</span>;
}

function useCounter(to: number, run: boolean, ms = 1100) {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (!run) {
      setV(0);
      return;
    }
    if (reduced()) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run, ms]);
  return v;
}

type Phase = "idle" | "typing" | "working" | "done";

export function MoneyTrailDemo() {
  const [ref, seen] = useInView<HTMLDivElement>({ threshold: 0.3 });
  const [index, setIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [typed, setTyped] = React.useState(0);
  const [tool, setTool] = React.useState(0);
  const [showSql, setShowSql] = React.useState(false);
  const [round, setRound] = React.useState(0);
  const sc = SCENARIOS[index]!;

  // One run: type the question, work through the tools, then show the trail.
  React.useEffect(() => {
    if (round === 0) return;
    setShowSql(false);
    setTool(0);
    if (reduced()) {
      setTyped(sc.question.length);
      setPhase("done");
      return;
    }
    setTyped(0);
    setPhase("typing");
    const timers: number[] = [];
    const per = 28;
    for (let i = 1; i <= sc.question.length; i++) timers.push(window.setTimeout(() => setTyped(i), i * per));
    let at = sc.question.length * per + 350;
    timers.push(window.setTimeout(() => setPhase("working"), at));
    sc.tools.forEach((_, i) => {
      timers.push(window.setTimeout(() => setTool(i), at));
      at += 780;
    });
    timers.push(window.setTimeout(() => setPhase("done"), at));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [round, sc]);

  // Starts by itself the first time the section is on screen.
  React.useEffect(() => {
    if (seen) setRound((r) => r || 1);
  }, [seen]);

  const run = (i: number) => {
    setIndex(i);
    setRound((r) => r + 1);
  };

  const done = phase === "done";
  const total = useCounter(sc.total, done);
  const current = sc.tools[Math.min(tool, sc.tools.length - 1)]!;
  const rows = useCounter(current.rows, phase === "working", 640);

  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#19191b]">
      <style>{`
        @keyframes mtIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
        @keyframes mtLine { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @keyframes mtFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .mt-in, .mt-fade { animation: none !important; opacity: 1 !important; } .mt-line { animation: none !important; } }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[#0f0f10] px-5 py-3 sm:px-7">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Try a question">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => run(i)}
              aria-pressed={i === index && phase !== "idle"}
              className={`h-7 rounded-full px-3 text-[13px] transition-colors duration-150 ${i === index && phase !== "idle" ? "bg-white/[0.12] text-zinc-50" : "bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100"}`}
            >
              {s.question}
            </button>
          ))}
        </div>
        <span className="font-mono text-xs text-zinc-600">demo store · made-up data</span>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.25fr]">
        {/* What each tool alone knows */}
        <div className="border-b border-white/[0.08] p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <p className="text-xs text-zinc-500">Each tool on its own</p>
          <ul className="mt-4 flex flex-col gap-2.5">
            {sc.silos.map((s) => (
              <li key={s.tool} className="rounded-xl border border-white/[0.08] px-4 py-3">
                <p className="text-xs text-zinc-500">{s.tool}</p>
                <p className="mt-1 text-sm text-zinc-300">{s.knows}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-600">
                  <Lock className="size-3" aria-hidden="true" /> cost in rupees: unknown
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Ask */}
        <div className="flex min-h-[420px] flex-col p-5 sm:p-7">
          <div className="flex items-center gap-2 rounded-full bg-white/[0.05] py-1.5 pl-4 pr-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
              {phase === "idle" ? <span className="text-zinc-500">Ask about your data</span> : sc.question.slice(0, typed)}
              {phase === "typing" && <Caret />}
            </span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.08] text-zinc-300">
              {phase === "working" || phase === "typing" ? <Spinner /> : <ArrowUp className="size-4" strokeWidth={1.5} />}
            </span>
          </div>

          <div className="mt-6 flex-1" aria-live="polite">
            {phase === "idle" && <p className="text-sm text-zinc-500">Pick a question above to watch it work.</p>}

            {phase === "working" && (
              <div key={tool} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" style={{ animation: "mtFade 0.25s ease-out both" }}>
                <span className="text-zinc-300">{current.label}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                  {current.table}
                  <span className="text-zinc-600">·</span>
                  <span className="tabular-nums text-zinc-200">{rows.toLocaleString("en-US")}</span> rows
                </span>
              </div>
            )}

            {done && (
              <div>
                <ol className="relative flex flex-col gap-4 pl-8">
                  <span aria-hidden="true" className="mt-line absolute bottom-2 left-[11px] top-2 w-px origin-top bg-white/[0.16]" style={{ animation: `mtLine ${0.2 * sc.trail.length}s cubic-bezier(0.22,1,0.36,1) both` }} />
                  {sc.trail.map((n, i) => {
                    const Icon = ICON[n.kind];
                    const last = i === sc.trail.length - 1;
                    return (
                      <li key={n.title} className="mt-in relative" style={{ animation: `mtIn 0.3s cubic-bezier(0.22,1,0.36,1) ${i * 0.18}s both` }}>
                        <span className={`absolute -left-8 top-0 grid size-[23px] place-items-center rounded-full ${last ? "bg-[#e5484d]/15 text-[#e5484d]" : "bg-white/[0.08] text-zinc-300"}`}>
                          <Icon className="size-3" />
                        </span>
                        <p className={`text-sm leading-5 ${last ? "text-zinc-50" : "text-zinc-200"}`}>{n.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-zinc-500">{n.detail}</p>
                      </li>
                    );
                  })}
                </ol>

                <div className="mt-fade mt-5 border-t border-white/[0.08] pt-4" style={{ animation: `mtFade 0.4s ease-out ${0.18 * sc.trail.length}s both` }}>
                  <p className="flex items-baseline gap-3">
                    <span className="font-mono text-[34px] leading-none tabular-nums text-zinc-50">₹{total.toLocaleString("en-IN")}</span>
                    <span className="text-sm text-zinc-400">{sc.caption}</span>
                  </p>
                  <p className="mt-2 max-w-md text-xs leading-5 text-zinc-500">{sc.basis}</p>
                  <button type="button" onClick={() => setShowSql((v) => !v)} aria-expanded={showSql} className="mt-3 text-xs text-zinc-400 underline decoration-white/20 underline-offset-4 transition-colors duration-150 hover:text-zinc-100">
                    {showSql ? "Hide the query" : "Show the query behind it"}
                  </button>
                  {showSql && <pre className="mt-fade mt-3 overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-5 text-zinc-300" style={{ animation: "mtFade 0.2s ease-out both" }}>{sc.sql}</pre>}
                </div>
              </div>
            )}
          </div>

          {done && (
            <button type="button" onClick={() => run(index)} className="mt-5 inline-flex h-7 w-fit items-center gap-2 rounded-md px-2 font-mono text-xs text-zinc-500 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-200">
              <RotateCcw className="size-3.5" strokeWidth={1.5} /> Replay
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
