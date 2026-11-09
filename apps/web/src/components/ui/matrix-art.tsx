import type { ReactNode } from "react";
import { GlyphField, type GlyphVariant } from "@trackme/landing";

/**
 * A matrix picture for the places a screen has nothing to show yet: an empty list, a chart on
 * day one, a quiet panel. The shape says what will appear there. Content can sit on top of it.
 */
export function MatrixArt({
  variant,
  className = "h-28",
  strength = 0.8,
  children,
}: {
  variant: GlyphVariant;
  className?: string;
  strength?: number;
  children?: ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-white/[0.06] bg-sidebar ${className}`}>
      <GlyphField variant={variant} cell={9} strength={strength} />
      {children && (
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="max-w-xs rounded-lg bg-sidebar/90 px-4 py-3 backdrop-blur-[2px]">{children}</div>
        </div>
      )}
    </div>
  );
}
