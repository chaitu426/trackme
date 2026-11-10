"use client";

import * as React from "react";
import { Check, Eye, ShieldCheck, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, inputClass } from "@/components/ui/field";
import { PillTabs } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";
import { RANGES, SOURCES, type AskScope, type RangeId, type SourceId } from "@/lib/ask/types";

const MAX_INSTRUCTIONS = 800;

function Row({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-zinc-200">{title}</p>
        {detail && <p className="mt-0.5 text-xs leading-5 text-zinc-500">{detail}</p>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-medium text-zinc-400">{title}</h4>
      <div className="divide-y divide-white/[0.05]">{children}</div>
    </section>
  );
}

/**
 * Everything the agent is allowed to look at, and how, in one place. Changes apply to the next question and are kept for the next visit.
 * Nothing here is hidden from the person and nothing is wider than they set it.
 */
export function AskConfigure({ scope, sites, onChange }: { scope: AskScope; sites: string[]; onChange: (next: AskScope) => void }) {
  const set = (patch: Partial<AskScope>) => onChange({ ...scope, ...patch });
  const toggleSite = (domain: string) => {
    const has = scope.siteDomains.includes(domain);
    // At least one site must stay in scope, or there is nothing to ask about.
    if (has && scope.siteDomains.length === 1) return;
    set({ siteDomains: has ? scope.siteDomains.filter((d) => d !== domain) : [...scope.siteDomains, domain] });
  };

  return (
    <div className="flex flex-col gap-5 pb-2">
      <Section title="Websites in scope">
        {sites.map((d) => (
          <Row key={d} title={d}>
            <Switch aria-label={`Include ${d}`} checked={scope.siteDomains.includes(d)} onCheckedChange={() => toggleSite(d)} />
          </Row>
        ))}
        {sites.length === 0 && <p className="py-3 text-xs text-zinc-500">Add a website to ask about it.</p>}
      </Section>

      <Section title="Time range">
        <div className="py-2.5">
          <PillTabs kind="radio" size="sm" label="Default time range" value={scope.range} onChange={(range: RangeId) => set({ range })} items={RANGES.map((r) => ({ id: r.id, label: r.id }))} />
          <p className="mt-2 text-xs text-zinc-500">Used when a question does not say. A question like &ldquo;yesterday&rdquo; overrides it.</p>
        </div>
      </Section>

      <Section title="Data I can read">
        {SOURCES.map((s) => (
          <Row key={s.id} title={s.label} detail={s.detail}>
            <Switch aria-label={`Allow ${s.label}`} checked={scope.sources[s.id]} onCheckedChange={(on) => set({ sources: { ...scope.sources, [s.id as SourceId]: on } })} />
          </Row>
        ))}
      </Section>

      <Section title="Privacy and limits">
        <Row title="Mask personal data" detail="Names, emails and user ids are hidden in results, and never sent to the model.">
          <Switch aria-label="Mask personal data" checked={scope.piiMasked} onCheckedChange={(piiMasked) => set({ piiMasked })} />
        </Row>
        <Row title="Most rows per query" detail="A query that would return more is stopped, not truncated silently.">
          <div className="w-28">
            <NativeSelect aria-label="Most rows per query" value={String(scope.maxRows)} onChange={(e) => set({ maxRows: Number(e.target.value) })} className="w-full">
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="1000">1,000</option>
            </NativeSelect>
          </div>
        </Row>
      </Section>

      <Section title="What I should know about your business">
        <div className="py-2.5">
          <label htmlFor="ask-instructions" className="sr-only">
            Instructions
          </label>
          <textarea
            id="ask-instructions"
            value={scope.instructions}
            onChange={(e) => set({ instructions: e.target.value.slice(0, MAX_INSTRUCTIONS) })}
            rows={4}
            placeholder={'For example: "Checkout is /checkout. Our busy season is November. An active user is someone with 3 sessions in a week."'}
            className={cn(inputClass, "h-auto resize-none py-2 text-sm leading-6")}
          />
          <p className="mt-1.5 flex justify-between text-xs text-zinc-500">
            <span>Added to every question. Do not put secrets here.</span>
            <span className="font-mono tabular-nums">
              {scope.instructions.length}/{MAX_INSTRUCTIONS}
            </span>
          </p>
        </div>
      </Section>

      <section>
        <h4 className="mb-2 text-xs font-medium text-zinc-400">What I can and cannot do</h4>
        <ul className="flex flex-col gap-1.5 text-xs leading-5">
          <li className="flex items-start gap-2 text-zinc-300">
            <Check className="mt-0.5 size-3.5 shrink-0 text-good" aria-hidden="true" /> Read the data above and run read-only queries on it
          </li>
          <li className="flex items-start gap-2 text-zinc-300">
            <Eye className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden="true" /> Show you every query and every source behind every number
          </li>
          <li className="flex items-start gap-2 text-zinc-300">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden="true" /> Stay inside your workspace and the websites you chose
          </li>
          <li className="flex items-start gap-2 text-zinc-500">
            <X className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Change settings, delete data, send messages or call outside services
          </li>
        </ul>
      </section>
    </div>
  );
}
