import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info, Lightbulb, ShieldAlert } from "lucide-react";
import { GlyphField, Spot, type GlyphVariant } from "@trackme/landing";
import { cn, slugify } from "@/lib/utils";

/* ------------------------------------------------------------------------- */
/* Headings with anchors                                                     */
/* ------------------------------------------------------------------------- */

function textOf(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

export function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  const anchor = id ?? slugify(textOf(children));
  return (
    <h2 id={anchor} className="group scroll-mt-20">
      {children}
      <a
        href={`#${anchor}`}
        aria-label="Link to this section"
        className="no-underline-link ml-2 font-mono text-zinc-700 opacity-0 transition hover:text-zinc-400 group-hover:opacity-100 focus:opacity-100"
      >
        #
      </a>
    </h2>
  );
}

export function H3({ children, id }: { children: React.ReactNode; id?: string }) {
  const anchor = id ?? slugify(textOf(children));
  return (
    <h3 id={anchor} className="group scroll-mt-20">
      {children}
      <a
        href={`#${anchor}`}
        aria-label="Link to this section"
        className="no-underline-link ml-2 font-mono text-zinc-700 opacity-0 transition hover:text-zinc-400 group-hover:opacity-100 focus:opacity-100"
      >
        #
      </a>
    </h3>
  );
}

/* ------------------------------------------------------------------------- */
/* Callouts                                                                  */
/* ------------------------------------------------------------------------- */

// Every callout sits on the same card surface; only the icon and its label change tone.
const CALLOUTS = {
  note: { icon: Info, label: "Note", iconColor: "text-zinc-400", rule: "bg-zinc-600" },
  tip: { icon: Lightbulb, label: "Tip", iconColor: "text-[#4cc38a]", rule: "bg-[#4cc38a]" },
  warning: { icon: AlertTriangle, label: "Heads up", iconColor: "text-amber-400", rule: "bg-amber-400" },
  danger: { icon: ShieldAlert, label: "Important", iconColor: "text-[#e5484d]", rule: "bg-[#e5484d]" },
} as const;

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: keyof typeof CALLOUTS;
  title?: string;
  children: React.ReactNode;
}) {
  const style = CALLOUTS[type];
  const Icon = style.icon;
  return (
    <div role="note" className="relative my-6 flex gap-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#19191b] p-4 pl-5">
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.5", style.rule)} />
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} />
      <div className="min-w-0 flex-1 text-[14px] leading-6 text-zinc-300 [&>*+*]:mt-2 [&_code]:text-[12px]">
        <p className="font-medium text-zinc-100">{title ?? style.label}</p>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Numbered steps                                                            */
/* ------------------------------------------------------------------------- */

export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="my-6 space-y-0 !list-none !pl-0 [counter-reset:step]">{children}</ol>;
}

export function Step({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <li className="relative !mt-0 flex gap-4 pb-9 last:pb-0 [counter-increment:step]">
      <div className="relative flex flex-col items-center">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.16] bg-[#141415] font-mono text-[13px] text-zinc-300 before:content-[counter(step)]" />
        <span className="mt-1 w-px flex-1 bg-white/[0.1] [li:last-child_&]:hidden" />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <h3 className="!mt-1 text-base font-medium text-zinc-50">{title}</h3>
        <div className="mt-2 [&>*+*]:mt-3">{children}</div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------- */
/* Reference tables                                                          */
/* ------------------------------------------------------------------------- */

export interface Param {
  name: string;
  type?: string;
  default?: string;
  required?: boolean;
  description: React.ReactNode;
}

const tableShell = "my-6 overflow-x-auto rounded-xl border border-white/[0.1] bg-[#19191b]";

export function ParamTable({ params, nameLabel = "Name" }: { params: Param[]; nameLabel?: string }) {
  return (
    <div className={tableShell}>
      <table className="min-w-[560px]">
        <thead className="bg-[#0f0f10]">
          <tr>
            <th>{nameLabel}</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={param.name}>
              <td className="whitespace-nowrap align-top">
                <code>{param.name}</code>
                {param.required && <span className="ml-2 font-mono text-[11px] text-[#e5484d]">required</span>}
              </td>
              <td className="whitespace-nowrap align-top font-mono text-[12px] text-zinc-400">{param.type ?? ""}</td>
              <td className="whitespace-nowrap align-top font-mono text-[12px] text-zinc-500">{param.default ?? "—"}</td>
              <td className="min-w-[220px] align-top">{param.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A plain table with an arbitrary header, for status codes and similar lists. */
export function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className={tableShell}>
      <table className="min-w-[520px]">
        <thead className="bg-[#0f0f10]">
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Link cards                                                                */
/* ------------------------------------------------------------------------- */

export function LinkCard({
  href,
  title,
  description,
  icon,
  external = false,
  art,
}: {
  href: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  external?: boolean;
  /** A matrix picture across the top of the card. */
  art?: GlyphVariant;
}) {
  const body = (
    <>
      {art && (
        <div className="relative h-28 overflow-hidden border-b border-white/[0.08] bg-[#0f0f10]">
          <GlyphField variant={art} cell={8} strength={0.9} />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {icon && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#232325] text-zinc-300">
                {icon}
              </span>
            )}
            <span className="text-sm font-medium text-zinc-100">{title}</span>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-600 transition group-hover:text-zinc-200" />
        </div>
        <p className="mt-3 text-[13px] leading-5 text-zinc-500">{description}</p>
      </div>
    </>
  );
  const className = "no-underline-link group block overflow-hidden rounded-xl border border-white/[0.08] bg-[#19191b] transition-colors duration-150 hover:border-white/[0.14]";
  const link = external ? (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
  return <Spot className="rounded-xl">{link}</Spot>;
}

export function CardGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={cn("my-6 grid gap-4", cols === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2")}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Small pieces                                                              */
/* ------------------------------------------------------------------------- */

export function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const tones = {
    default: "border-white/[0.1] text-zinc-300",
    success: "border-white/[0.1] text-[#4cc38a]",
    warning: "border-white/[0.1] text-amber-400",
    danger: "border-white/[0.1] text-[#e5484d]",
  };
  return (
    <span className={cn("inline-flex items-center rounded-md border bg-[#19191b] px-2 py-0.5 font-mono text-[12px]", tones[tone])}>
      {children}
    </span>
  );
}
