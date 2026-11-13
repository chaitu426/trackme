"use client";

import * as React from "react";
import { ArrowRight, Check } from "lucide-react";
import { SmartLink } from "./smart-link";
import { GlyphField } from "./glyph-field";
import { Reveal } from "./motion";

/** One plan as the landing page shows it. The host builds these from the real plan table, so the page cannot promise more than the app allows. */
export interface PricingPlan {
  id: "free" | "pro";
  name: string;
  tagline: string;
  /** Already formatted, for example "$29". */
  monthly: string;
  /** The yearly price per month, formatted, for example "$24". */
  yearlyPerMonth: string;
  /** The whole year, formatted, for example "$290". */
  yearlyTotal: string;
  features: string[];
}

export interface PricingProps {
  plans: PricingPlan[];
  /** Percent saved by paying yearly; 0 hides the note. */
  yearlySaving: number;
  /** Where each plan's button goes. */
  freeHref: string;
  proHref: string;
  /** The signed-in visitor's plan. Their card says so instead of selling to them. */
  currentPlan?: "free" | "pro" | undefined;
  /** The billing page, for someone already on Pro. */
  manageHref?: string | undefined;
}

type Interval = "month" | "year";

export function Pricing({ plans, yearlySaving, freeHref, proHref, currentPlan, manageHref }: PricingProps) {
  const [interval, setInterval] = React.useState<Interval>("year");

  return (
    <div>
      <Reveal delay={60}>
        <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-lg border border-white/[0.12] bg-[#0f0f10] p-1">
          {(["month", "year"] as const).map((value) => {
            const on = interval === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setInterval(value)}
                className={`rounded-md px-4 py-1.5 text-sm transition-colors duration-150 ${on ? "bg-[#232325] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {value === "month" ? "Monthly" : yearlySaving > 0 ? `Yearly · save ${yearlySaving}%` : "Yearly"}
              </button>
            );
          })}
        </div>
      </Reveal>

      <div className="mt-8 grid gap-4 lg:grid-cols-2 lg:gap-5">
        {plans.map((plan, i) => {
          const pro = plan.id === "pro";
          const mine = currentPlan === plan.id;
          const price = pro ? (interval === "year" ? plan.yearlyPerMonth : plan.monthly) : "$0";
          const href = pro ? (mine && manageHref ? manageHref : proHref) : mine && manageHref ? manageHref : freeHref;
          const label = mine ? (pro ? "Manage your plan" : "Your current plan") : pro ? "Upgrade to Pro" : "Start free";
          const bright = pro && !mine;
          return (
            <Reveal key={plan.id} delay={80 + i * 90}>
              <article
                className={`relative flex h-full flex-col overflow-hidden rounded-2xl border p-7 sm:p-8 ${
                  pro ? "border-white/[0.26] bg-[#0f0f10] shadow-[0_32px_64px_-32px_rgba(0,0,0,0.9)]" : "border-white/[0.1] bg-[#141415]"
                }`}
              >
                {pro && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-44 opacity-80 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true">
                    <GlyphField variant="gauge" cell={10} strength={0.55} className="absolute inset-0 h-full w-full" />
                  </div>
                )}

                <div className="relative flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase leading-4 tracking-[0.14em] ${
                      pro ? "border-white/[0.28] bg-white/[0.07] text-zinc-50" : "border-white/[0.12] text-zinc-400"
                    }`}
                  >
                    <span aria-hidden="true" className={pro ? "text-zinc-50" : "text-zinc-500"}>
                      {pro ? "##" : ".:"}
                    </span>
                    {plan.name}
                  </span>
                  {mine && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#4cc38a]">Your plan</span>}
                  {!mine && pro && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">Everything unlocked</span>}
                </div>

                <div className="relative mt-8 flex items-baseline gap-2">
                  <span className="font-mono text-[52px] font-normal leading-none tracking-[-0.04em] text-zinc-50 tabular-nums">{price}</span>
                  <span className="text-sm text-zinc-500">{pro ? "/ month" : "forever"}</span>
                </div>
                <p className="relative mt-2 h-5 text-[13px] text-zinc-500">
                  {pro ? (interval === "year" ? `${plan.yearlyTotal} billed once a year` : "Billed monthly, cancel any time") : "No card needed"}
                </p>

                <p className="relative mt-6 text-[15px] leading-6 text-zinc-400">{plan.tagline}</p>

                <ul className="relative mt-6 flex-1 space-y-3 border-t border-white/[0.08] pt-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-[15px] leading-6 text-zinc-300">
                      <Check className={`mt-1 h-4 w-4 shrink-0 ${pro ? "text-[#4cc38a]" : "text-zinc-500"}`} strokeWidth={1.75} aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <SmartLink
                  href={href}
                  className={`group relative mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-medium transition-[background-color,transform,border-color] duration-150 active:scale-[0.98] ${
                    bright
                      ? "bg-[#ededed] text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white"
                      : "border border-white/[0.12] bg-[#232325]/80 text-zinc-100 hover:border-white/[0.24]"
                  }`}
                >
                  {label}
                  {(bright || (pro && mine)) && <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.5} />}
                </SmartLink>
              </article>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
