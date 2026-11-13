import Link from "next/link";
import { Lock } from "lucide-react";
import { GlyphField, type GlyphVariant } from "@trackme/landing";
import { Card } from "@/components/ui/card";
import { PlanBadge } from "@/components/plan/plan-badge";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a page shows instead of a feature the plan does not include: what it is, what it would show, and one way forward.
 * The same quiet glyph picture as the empty states sits behind it, so a locked page still looks like this product.
 */
export function LockedFeature({
  title,
  children,
  workspaceSlug,
  art = "gauge",
  canUpgrade = true,
}: {
  title: string;
  children: React.ReactNode;
  workspaceSlug: string;
  art?: GlyphVariant;
  /** False when the viewer cannot change the plan: the page then points them to the company owner instead of a button. */
  canUpgrade?: boolean;
}) {
  return (
    <Card className="enter relative flex flex-col items-center overflow-hidden py-16 text-center">
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_62%_72%_at_50%_50%,black,transparent)]" aria-hidden="true">
        <GlyphField variant={art} cell={9} strength={0.5} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="relative flex max-w-md flex-col items-center">
        <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-zinc-300">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <PlanBadge plan="pro" className="mb-3" />
        <h2 className="text-sm font-medium text-zinc-50">{title}</h2>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400">{children}</p>
        <div className="mt-5">
          {canUpgrade ? (
            <Link href={`/${workspaceSlug}/settings/billing`} className={cn(buttonBase, buttonVariants.primary, buttonSizes.md)}>
              See plans
            </Link>
          ) : (
            <p className="text-xs text-zinc-500">Ask your company owner to upgrade to Pro.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
