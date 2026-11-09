"use client";

import * as React from "react";

/**
 * The product mark, shared by the landing page and the app: a light tile holding a 3 by 3 wave of the data glyphs (. : + #),
 * the same wave the loaders use. It steps slowly, and holds one still frame when reduced motion is on.
 * The app's logo (apps/web/src/components/brand/logo-mark.tsx) renders this component; the loaders use the same ramp and wave.
 */
const RAMP = [".", ":", "+", "#"];

export function LogoMark({ size = 24 }: { size?: number }) {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setFrame((f) => f + 1), 150);
    return () => window.clearInterval(t);
  }, []);
  const cell = Math.round(size * 0.22);
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-[#ededed] text-[#141415]" style={{ width: size, height: size }}>
      <span className="inline-grid select-none font-mono font-semibold" style={{ gridTemplateColumns: `repeat(3, ${cell}px)`, gridAutoRows: `${cell + 1}px`, fontSize: cell + 3, lineHeight: `${cell + 1}px` }}>
        {Array.from({ length: 9 }, (_, i) => {
          const phase = (((frame - (Math.floor(i / 3) + (i % 3))) % 7) + 7) % 7;
          const level = phase < 4 ? phase : -1;
          return (
            <span key={i} className="text-center" style={{ opacity: level < 0 ? 0.18 : 0.35 + level * 0.22 }}>
              {RAMP[level < 0 ? 0 : level]}
            </span>
          );
        })}
      </span>
    </span>
  );
}
