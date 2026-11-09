import * as React from "react";
import Link from "next/link";
import { Activity, ArrowRight, type LucideIcon } from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { Notice } from "@/components/motion/primitives";
import { inputClass } from "@/components/ui/field";
import { buttonBase, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame for sign in and sign up: the form on the left, and on the right the same traffic
 * picture as the landing page with the three things the product promises, in plain words.
 */
export function AuthShell({
  alt,
  children,
}: {
  /** The link to the other page: "Create workspace" on sign in, "Sign in" on sign up. */
  alt: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-background text-zinc-100 antialiased lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-screen flex-col px-6 sm:px-10">
        <header className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-base font-medium leading-none text-zinc-50" aria-label="TrackMe home">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[#ededed] text-[#141415]">
              <Activity className="h-4 w-4" />
            </span>
            TrackMe
          </Link>
          <Link href={alt.href} className="press inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
            {alt.label} <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</main>

        <footer className="flex h-14 items-center gap-6 text-[13px] text-zinc-500">
          <span>© {new Date().getFullYear()} TrackMe</span>
          <Link href="/legal/privacy" className="transition-colors duration-150 hover:text-zinc-200">
            Privacy
          </Link>
        </footer>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-white/[0.08] bg-sidebar lg:block" aria-hidden="true">
        <GlyphField variant="ridge" cell={9} interactive />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-[linear-gradient(to_top,#0f0f10_0%,#0f0f10_55%,rgba(15,15,16,0)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#0f0f10] to-transparent" />
        <div className="absolute inset-x-10 bottom-12 max-w-md">
          <p className="font-mono text-xs text-zinc-500">What TrackMe keeps</p>
          <h2 className="mt-4 text-balance text-[32px] font-medium leading-10 tracking-[-0.03em] text-zinc-50">
            Know what visitors do. Keep nothing that identifies them.
          </h2>
          <dl className="mt-8 space-y-3 font-mono text-[13px]">
            {[
              ["Cookies", "no tracking cookies"],
              ["IP address", "dropped at the edge"],
              ["Visitor ID", "rotates every 24 hours"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-6 border-b border-white/[0.08] pb-3 last:border-0 last:pb-0">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="text-zinc-100">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}

export function AuthTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-[28px] font-medium leading-9 tracking-[-0.02em] text-zinc-50">{title}</h1>
      {children && <p className="mt-2 text-sm leading-5 text-zinc-400">{children}</p>}
    </div>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Something to the right of the label, like a link. */
  aside?: React.ReactNode;
  /** A control on the right edge of the input, like a show-password toggle. */
  trailing?: React.ReactNode;
  hint?: string;
};

export function Field({ id, label, icon: Icon, aside, trailing, hint, className = "", ...input }: FieldProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={id} className="text-sm text-zinc-300">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          {...input}
          className={cn(inputClass, "pl-10", trailing ? "pr-11" : "pr-3", className)}
        />
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {hint && <p className="mt-2 text-xs leading-4 text-zinc-500">{hint}</p>}
    </div>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <Notice nonce={typeof children === "string" ? children : "error"} className="rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-sm text-[#e5484d]">
      {children}
    </Notice>
  );
}

export const authPrimary = cn(buttonBase, buttonVariants.primary, "h-10 w-full gap-2 rounded-lg px-4 text-sm");
