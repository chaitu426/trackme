import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The code is set in the product's own glyphs (. : + #), the same picture language as the landing page and the page headers.
 * The glyphs near the pointer light up, so the page is something to touch rather than a dead end.
 */
export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 text-center">
      <div className="relative h-[34vh] min-h-[180px] w-full max-w-3xl" aria-hidden="true">
        <GlyphField variant="text" text="404" cell={9} interactive className="absolute inset-0 h-full w-full" />
      </div>

      <div className="relative z-10 mt-4 flex flex-col items-center">
        <p className="enter font-mono text-xs text-zinc-500">Page not found</p>
        <h1 className="enter mt-3 text-[32px] font-medium leading-10 tracking-[-0.02em] text-zinc-50" style={{ ["--i" as string]: 1 }}>
          Nothing is tracked at this address
        </h1>
        <p className="enter mt-3 max-w-sm text-sm leading-6 text-zinc-400" style={{ ["--i" as string]: 2 }}>
          The page does not exist, was moved, or belongs to a workspace you are not a member of.
        </p>
        <div className="enter mt-8 flex flex-wrap items-center justify-center gap-3" style={{ ["--i" as string]: 3 }}>
          <Link href="/" className={cn(buttonBase, buttonVariants.primary, buttonSizes.lg)}>
            Go to the dashboard
          </Link>
          <Link href="/login" className={cn(buttonBase, buttonVariants.outline, buttonSizes.lg)}>
            <ArrowLeft aria-hidden="true" />
            Sign in
          </Link>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" aria-hidden="true" />
    </div>
  );
}
