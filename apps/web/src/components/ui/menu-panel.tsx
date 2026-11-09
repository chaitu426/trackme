"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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

type Placement = "above-start" | "right-end" | "below-start";

/**
 * A menu drawn in a portal on the page and positioned from its trigger, for triggers that sit inside something that clips (the
 * sidebar, a scroll area). `above-start` opens upward over the trigger's left edge at the trigger's width, `right-end` opens to
 * the trigger's right, bottom-aligned (the collapsed rail), `below-start` opens downward. Closes on Escape. It carries
 * `data-portal-menu`, so a click-outside handler can tell a click inside the menu from one outside it.
 */
export function PortalMenu({
  open,
  anchor,
  placement,
  children,
  className,
  onEscape,
  ...aria
}: {
  open: boolean;
  anchor: () => HTMLElement | null | undefined;
  placement: Placement;
  children: React.ReactNode;
  className?: string;
  onEscape?: () => void;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "role" | "aria-label">) {
  const [box, setBox] = React.useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor()?.getBoundingClientRect();
      if (!rect) return;
      const vh = window.innerHeight;
      if (placement === "above-start") setBox({ left: rect.left, bottom: vh - rect.top + 8, width: rect.width });
      else if (placement === "right-end") setBox({ left: rect.right + 8, bottom: vh - rect.bottom, width: rect.width });
      else setBox({ left: rect.left, top: rect.bottom + 8, width: rect.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, placement]);

  React.useEffect(() => {
    if (!open || !onEscape) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onEscape]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && box && (
        <motion.div
          {...aria}
          data-portal-menu=""
          className={cn("fixed z-[110] rounded-xl border border-border bg-card shadow-float", className)}
          style={{ left: box.left, ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }), minWidth: placement === "right-end" ? 224 : box.width, transformOrigin: placement === "below-start" ? "top" : "bottom" }}
          initial={{ opacity: 0, y: placement === "below-start" ? -6 : 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: placement === "below-start" ? -4 : 4 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
