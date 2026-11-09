import type { ReactNode } from "react";
import { GlyphField, type GlyphVariant } from "@trackme/landing";

/**
 * The title block every dashboard page opens with. A quiet matrix picture sits behind its
 * right side, drawn with the same glyph language as the landing page, and its shape says
 * what the page is about: traffic, a stream of events, a globe, a gauge, funnel steps.
 */
export function PageHeader({
  title,
  art = "ridge",
  actions,
  children,
}: {
  title: string;
  art?: GlyphVariant;
  /** Controls on the right: the range switcher, filters, a primary action. */
  actions?: ReactNode;
  /** The one-line description under the title. */
  children?: ReactNode;
}) {
  return (
    <header className="relative rounded-2xl border border-white/[0.08] bg-sidebar">
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true">
        <div className="absolute inset-y-0 right-0 hidden w-[52%] [mask-image:linear-gradient(to_right,transparent,black_55%)] md:block">
          <GlyphField variant={art} cell={9} strength={0.55} />
        </div>
      </div>
      <div className="relative z-10 flex flex-col justify-between gap-4 px-6 py-6 text-left lg:flex-row lg:items-center">
        <div className="min-w-0">
          <h1 className="text-title font-medium text-zinc-50">{title}</h1>
          {children && <p className="mt-1 max-w-xl text-sm leading-5 text-zinc-400">{children}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sidebar/90 p-1 backdrop-blur-[2px]">{actions}</div>}
      </div>
    </header>
  );
}
