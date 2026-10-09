import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info, Lightbulb, ShieldAlert } from "lucide-react";
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
        className="no-underline-link ml-2 text-zinc-700 opacity-0 transition hover:text-zinc-400 group-hover:opacity-100 focus:opacity-100"
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
        className="no-underline-link ml-2 text-zinc-700 opacity-0 transition hover:text-zinc-400 group-hover:opacity-100 focus:opacity-100"
      >
        #
      </a>
    </h3>
  );
}

/* ------------------------------------------------------------------------- */
/* Callouts                                                                  */
/* ------------------------------------------------------------------------- */

const CALLOUTS = {
  note: {
    icon: Info,
    label: "Note",
    box: "border-white/[0.08] bg-white/[0.02]",
    iconColor: "text-zinc-400",
  },
  tip: {
    icon: Lightbulb,
    label: "Tip",
    box: "border-emerald-500/20 bg-emerald-500/[0.05]",
    iconColor: "text-emerald-400",
  },
  warning: {
    icon: AlertTriangle,
    label: "Heads up",
    box: "border-amber-500/20 bg-amber-500/[0.05]",
    iconColor: "text-amber-400",
  },
  danger: {
    icon: ShieldAlert,
    label: "Important",
    box: "border-rose-500/20 bg-rose-500/[0.05]",
    iconColor: "text-rose-400",
  },
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
    <div role="note" className={cn("my-5 flex gap-3 rounded-xl border p-4", style.box)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} strokeWidth={2.2} />
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-zinc-300 [&>*+*]:mt-2 [&_code]:text-[12px]">
        <p className="font-semibold text-zinc-100">{title ?? style.label}</p>
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
    <li className="relative !mt-0 flex gap-4 pb-8 last:pb-0 [counter-increment:step]">
      <div className="relative flex flex-col items-center">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900 font-mono text-[11px] font-semibold text-zinc-300 before:content-[counter(step)]" />
        <span className="mt-1 w-px flex-1 bg-white/[0.08] [li:last-child_&]:hidden" />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <h3 className="!mt-0 text-[15px] font-semibold text-zinc-50">{title}</h3>
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

export function ParamTable({ params, nameLabel = "Name" }: { params: Param[]; nameLabel?: string }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="min-w-[560px]">
        <thead className="bg-white/[0.02]">
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
                {param.required && (
                  <span className="ml-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-rose-300">
                    required
                  </span>
                )}
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
export function SimpleTable({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="min-w-[520px]">
        <thead className="bg-white/[0.02]">
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
}: {
  href: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  external?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-300">
              {icon}
            </span>
          )}
          <span className="text-[13px] font-semibold text-zinc-100">{title}</span>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition group-hover:text-zinc-300" />
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-zinc-500">{description}</p>
    </>
  );
  const className = "linear-card no-underline-link group block p-4";
  return external ? (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

export function CardGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={cn("my-5 grid gap-3", cols === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2")}>
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
    default: "border-white/10 bg-white/[0.04] text-zinc-300",
    success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    warning: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    danger: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}
