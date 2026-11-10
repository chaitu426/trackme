import { LogoMark as Mark } from "@trackme/landing";
import { cn } from "@/lib/utils";

/**
 * The TrackMe mark, from one implementation shared with the landing page (packages/landing/src/logo-mark.tsx): a light tile holding
 * the glyph wave that the loaders use, so the logo and the "working" state are one idea. Pass `className` only to place it.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <Mark size={28} />
    </span>
  );
}
