"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Bell, BellRing, Bug, Check, ClipboardList, FileText, IndianRupee, Rocket, Server, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { caseFile, ticketText } from "@/lib/ask/case-file";
import type { Answer, TrailNode, Trail, WatchSpec } from "@/lib/ask/types";

const EASE = [0.22, 1, 0.36, 1] as const;
const ICON: Record<TrailNode["kind"], React.ComponentType<{ className?: string }>> = { release: Rocket, error: Bug, gateway: Server, funnel: Users, money: IndianRupee };

/**
 * The money trail: from the cause down to the rupees it cost, one link per line, each link citing its evidence. This is the thing
 * only TrackMe can draw, because errors, releases, gateways, checkout sessions and payments are in the same place. The line grows
 * down as the links appear; the last link is the number.
 */
export function MoneyTrail({ trail, onOpen, fresh }: { trail: Trail; onOpen: (n: number) => void; fresh: boolean }) {
  const reduce = useReducedMotion();
  const animate = fresh && !reduce;
  return (
    <section aria-label="Cause to cost">
      <p className="mb-3 text-xs text-zinc-500">Cause to cost</p>
      <ol className="relative flex flex-col gap-4 pl-8">
        <motion.span aria-hidden="true" className="absolute bottom-2 left-[11px] top-2 w-px origin-top bg-white/[0.14]" initial={animate ? { scaleY: 0 } : false} animate={{ scaleY: 1 }} transition={{ duration: 0.2 * trail.nodes.length, ease: EASE }} />
        {trail.nodes.map((n, i) => {
          const Icon = ICON[n.kind];
          const last = i === trail.nodes.length - 1;
          return (
            <motion.li key={i} className="relative" initial={animate ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, delay: animate ? 0.18 * i : 0, ease: EASE }}>
              <span className={cn("absolute -left-8 top-0 grid size-[23px] place-items-center rounded-full", last ? "bg-bad/15 text-bad" : "bg-white/[0.08] text-zinc-300")}>
                <Icon className="size-3" />
              </span>
              <p className={cn("text-sm leading-5", last ? "text-zinc-50" : "text-zinc-200")}>
                {n.title}
                {n.cite && (
                  <button type="button" onClick={() => onOpen(n.cite!)} aria-label={`Show evidence ${n.cite}`} className="press ml-1.5 inline-grid h-[15px] min-w-[15px] -translate-y-px place-items-center rounded-full bg-white/[0.08] px-1 font-mono text-[9px] leading-none text-zinc-300 hover:bg-white/[0.16]">
                    {n.cite}
                  </button>
                )}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                {n.at ? `${n.at} · ` : ""}
                {n.detail}
              </p>
            </motion.li>
          );
        })}
      </ol>
      <div className="mt-4 flex items-baseline gap-3 border-t border-white/[0.06] pt-3">
        <span className="font-mono text-2xl tabular-nums text-zinc-50">{trail.total.value}</span>
        <span className="text-sm text-zinc-400">{trail.total.label}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{trail.total.basis}</p>
    </section>
  );
}

/* ───────────────────────────── make it stick ───────────────────────────── */

const WATCH_KEY = "trackme_ask_watches";
const CHANNELS = ["Email", "Slack", "Webhook"] as const;

function readWatches(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}
function writeWatches(w: Record<string, string[]>) {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(w));
  } catch {
    // Not kept this time; the armed state still shows for this session.
  }
}

function Watch({ spec }: { spec: WatchSpec }) {
  const [armed, setArmed] = React.useState<string[] | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [channels, setChannels] = React.useState<string[]>(["Email"]);
  React.useEffect(() => {
    setArmed(readWatches()[spec.id] ?? null);
  }, [spec.id]);

  const arm = () => {
    const all = readWatches();
    all[spec.id] = channels;
    writeWatches(all);
    setArmed(channels);
    setEditing(false);
  };
  const disarm = () => {
    const all = readWatches();
    delete all[spec.id];
    writeWatches(all);
    setArmed(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {armed ? (
          <button type="button" onClick={disarm} className="press inline-flex items-center gap-1.5 rounded-full bg-good/10 px-3 py-1.5 text-xs text-good hover:bg-good/15" aria-label="Stop watching">
            <BellRing className="size-3.5" aria-hidden="true" /> Watching · {armed.join(", ")}
          </button>
        ) : (
          <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} className="press inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs text-zinc-100 hover:bg-white/[0.14]">
            <Bell className="size-3.5" aria-hidden="true" /> Watch this
          </button>
        )}
      </div>
      {editing && !armed && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: EASE }} className="flex flex-col gap-3 rounded-xl bg-white/[0.04] p-3">
          <p className="text-xs leading-5 text-zinc-300">
            Tell me when <span className="text-zinc-50">{spec.metric.toLowerCase()}</span> {spec.condition}. <span className="text-zinc-500">Now: {spec.now}.</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Where to tell you">
            {CHANNELS.map((c) => {
              const on = channels.includes(c);
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => setChannels((cur) => (on ? cur.filter((x) => x !== c) : [...cur, c]))} className={cn("press rounded-full px-3 py-1 text-xs transition-colors duration-150", on ? "bg-white/[0.16] text-zinc-50" : "bg-white/[0.05] text-zinc-500 hover:text-zinc-200")}>
                  {c}
                </button>
              );
            })}
            <button type="button" onClick={arm} disabled={channels.length === 0} className="press ml-auto rounded-full bg-[#ededed] px-3.5 py-1 text-xs text-[#141415] hover:bg-white disabled:opacity-40">
              Start watching
            </button>
          </div>
          <p className="text-[11px] text-zinc-600">Preview: the check is saved here for now. Alerts run it for real in the next release.</p>
        </motion.div>
      )}
    </div>
  );
}

function CopyAction({ label, done, icon: Icon, text }: { label: string; done: string; icon: React.ComponentType<{ className?: string }>; text: () => string }) {
  const [copied, setCopied] = React.useState(false);
  const t = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(t.current), []);
  const run = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: nothing to confirm.
    }
  };
  return (
    <button type="button" onClick={run} className="press inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/[0.1] hover:text-zinc-100">
      {copied ? <Check className="size-3.5 text-good" aria-hidden="true" /> : <Icon className="size-3.5" />}
      <span role="status">{copied ? done : label}</span>
    </button>
  );
}

/** What to do with a finding so it does not die in the panel: watch it, hand it over as a case file, or file it as a ticket. */
export function Actions({ question, answer, site, range }: { question: string; answer: Answer; site: string; range: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {answer.watch && <Watch spec={answer.watch} />}
        <CopyAction label="Copy case file" done="Copied" icon={FileText} text={() => caseFile(question, answer, { site, range, at: new Date() })} />
        {answer.trail && <CopyAction label="Copy ticket" done="Copied" icon={ClipboardList} text={() => ticketText(question, answer)} />}      </div>
    </div>
  );
}
