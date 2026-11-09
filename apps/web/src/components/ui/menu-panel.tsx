"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The floating surface under a dropdown, switcher or popover. It fades in and settles a few pixels from the trigger, and fades
 * out on close, so every menu in the app opens the same way. Position it with `className` (it is `absolute`; the trigger's wrapper
 * needs `relative`).
 */
export function MenuPanel({ open, children, className, ...aria }: { open: boolean; children: React.ReactNode; className?: string } & Pick<React.HTMLAttributes<HTMLDivElement>, "role" | "aria-label" | "id">) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...aria}
          className={cn("absolute z-50 rounded-xl border border-border bg-card shadow-float", className)}
          style={{ transformOrigin: "top" }}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
