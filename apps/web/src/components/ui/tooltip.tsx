"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

const OPEN_DELAY_MS = 350;

/**
 * A label that appears beside an element on hover or keyboard focus. It waits a beat so passing the pointer across a row of
 * icons does not flash a tooltip at each, fades and moves a few pixels, and never takes the pointer (it is not interactive).
 * Wrap one element; the tooltip describes it (`aria-describedby`).
 */
export function Tooltip({ content, children, side = "top", className }: { content: React.ReactNode; children: React.ReactElement; side?: "top" | "right" | "bottom"; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  const id = React.useId();

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const offset = side === "top" ? { y: 4 } : side === "bottom" ? { y: -4 } : { x: -4 };
  const place = side === "top" ? "bottom-full left-1/2 mb-2 -translate-x-1/2" : side === "bottom" ? "top-full left-1/2 mt-2 -translate-x-1/2" : "left-full top-1/2 ml-2 -translate-y-1/2";

  return (
    <span className="relative inline-flex" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => e.key === "Escape" && hide()}>
      {React.cloneElement(children, { "aria-describedby": open ? id : undefined } as React.HTMLAttributes<HTMLElement>)}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            className={cn("pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-raised px-2 py-1 text-xs text-zinc-100 shadow-float", place, className)}
            initial={{ opacity: 0, ...offset }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
