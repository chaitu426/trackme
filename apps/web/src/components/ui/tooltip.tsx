"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

const OPEN_DELAY_MS = 350;

type Side = "top" | "right" | "bottom";

/** Where the tooltip sits, from the trigger's rectangle. The wrapper below shifts it by its own size, so its width does not matter. */
function anchorPoint(rect: DOMRect, side: Side): { left: number; top: number } {
  if (side === "top") return { left: rect.left + rect.width / 2, top: rect.top };
  if (side === "bottom") return { left: rect.left + rect.width / 2, top: rect.bottom };
  return { left: rect.right, top: rect.top + rect.height / 2 };
}

const SHIFT: Record<Side, string> = {
  top: "-translate-x-1/2 -translate-y-full -mt-2",
  bottom: "-translate-x-1/2 mt-2",
  right: "-translate-y-1/2 ml-2",
};

/**
 * A label that appears beside an element on hover or keyboard focus. It is drawn in a portal on the page, positioned from the
 * trigger, so no scroll area or `overflow-hidden` parent (the collapsed sidebar rail) can clip it. It waits a beat so passing the
 * pointer across a row of icons does not flash a tooltip at each, fades and moves a few pixels, and never takes the pointer.
 */
export function Tooltip({ content, children, side = "top", className }: { content: React.ReactNode; children: React.ReactElement; side?: Side; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [point, setPoint] = React.useState<{ left: number; top: number } | null>(null);
  const trigger = React.useRef<HTMLSpanElement>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const id = React.useId();

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      setPoint(anchorPoint(rect, side));
      setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  // A scroll or resize would leave it behind: close instead of chasing.
  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  const offset = side === "top" ? { y: 4 } : side === "bottom" ? { y: -4 } : { x: -4 };

  return (
    <span ref={trigger} className="relative inline-flex" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => e.key === "Escape" && hide()}>
      {React.cloneElement(children, { "aria-describedby": open ? id : undefined } as React.HTMLAttributes<HTMLElement>)}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && point && (
              <span className={cn("pointer-events-none fixed z-[120]", SHIFT[side])} style={{ left: point.left, top: point.top }}>
                <motion.span
                  id={id}
                  role="tooltip"
                  className={cn("block whitespace-nowrap rounded-md border border-border bg-raised px-2 py-1 text-xs text-zinc-100 shadow-float", className)}
                  initial={{ opacity: 0, ...offset }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  {content}
                </motion.span>
              </span>
            )}
          </AnimatePresence>,
          document.body
        )}
    </span>
  );
}
