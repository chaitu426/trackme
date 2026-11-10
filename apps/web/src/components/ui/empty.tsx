import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { GlyphField, type GlyphVariant } from "@trackme/landing";
import { Card } from "./card";

/**
 * What a page shows when there is nothing to show yet: one line of what is missing, one line of how to get it, one action.
 * A quiet glyph picture sits behind it (the same language as the page headers) so an empty page still looks like this product.
 * The picture follows what the page is about; pass `art={null}` for none.
 */
export function Empty({ icon: Icon, title, children, action, art = "pulse" }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; art?: GlyphVariant | null }) {
  return (
    <Card className="enter relative flex flex-col items-center overflow-hidden py-14 text-center">
      {art && (
        <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_50%,black,transparent)]" aria-hidden="true">
          <GlyphField variant={art} cell={9} strength={0.45} className="absolute inset-0 h-full w-full" />
        </div>
      )}
      <div className="relative flex flex-col items-center">
        {Icon && (
          <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-zinc-400">
            <Icon className="size-5" aria-hidden="true" />
          </span>
        )}
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        {children && <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-400">{children}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </Card>
  );
}
