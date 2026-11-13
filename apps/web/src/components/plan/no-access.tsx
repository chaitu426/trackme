import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { FEATURE_INFO, type Feature } from "@trackme/contracts";
import { Card } from "@/components/ui/card";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What a person sees on a page their team has not been given. It says which part of the product it is and who can change
 * that, instead of a bare error, and keeps the quiet glyph picture of every other empty state.
 */
export function NoAccess({ feature, workspaceSlug }: { feature: Feature; workspaceSlug: string }) {
  const info = FEATURE_INFO[feature];
  return (
    <Card className="enter relative flex w-full flex-col items-center overflow-hidden py-16 text-center">
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_62%_72%_at_50%_50%,black,transparent)]" aria-hidden="true">
        <GlyphField variant="steps" cell={9} strength={0.4} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="relative flex max-w-md flex-col items-center">
        <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-zinc-300">
          <ShieldOff className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium text-zinc-50">Your team does not have access to {info.label} here</h2>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400">
          {info.description}. A workspace admin can add it to your team under Teams &amp; access. It is usually given to: {info.teams}.
        </p>
        <div className="mt-5">
          <Link href={`/${workspaceSlug}/settings`} className={cn(buttonBase, buttonVariants.secondary, buttonSizes.md)}>
            Back to the workspace
          </Link>
        </div>
      </div>
    </Card>
  );
}
