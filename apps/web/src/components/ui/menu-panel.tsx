"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The floating surface under a dropdown, switcher or popover. It fades in and settles a few pixels from the trigger, and fades
 * out on close, so every menu in the app opens the same way.
 *
 * It is drawn in a portal on the page, positioned from its trigger's wrapper (the element it is written inside, which needs no
 * special style), so no card, header or animated section can stack above it or clip it. `className` sets the width and look;
 * `left-0 right-0` makes it as wide as the trigger. It carries `data-portal-menu`, so a click-outside handler can tell a click
 * inside the menu from one outside it.
 */
export function MenuPanel({ open, children, className, ...aria }: { open: boolean; children: React.ReactNode; className?: string } & Pick<React.HTMLAttributes<HTMLDivElement>, "role" | "aria-label" | "id">) {
  const marker = React.useRef<HTMLSpanElement>(null);
  const [box, setBox] = React.useState<{ left: number; top: number; width: number } | null>(null);
  const stretch = /(^|\s)right-0(\s|$)/.test(className ?? "");
  // Position words are handled here; the rest of the classes (width, padding, overflow) pass through.
  const rest = (className ?? "").replace(/(^|\s)(left-0|right-0|top-full|mt-2)(?=\s|$)/g, " ").trim();

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = marker.current?.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const next = { left: rect.left, top: rect.bottom + 8, width: rect.width };
      setBox((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <>
      <span ref={marker} hidden />
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && box && (
              <motion.div
                {...aria}
                data-portal-menu=""
                className={cn("fixed z-[110] rounded-xl border border-border bg-card shadow-float", rest)}
                style={{ left: box.left, top: box.top, ...(stretch ? { width: box.width } : {}), transformOrigin: "top" }}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
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
  type Box = { left: number; top?: number; bottom?: number; width: number };
  const [box, setBox] = React.useState<Box | null>(null);
  // Callers pass a fresh function every render. Keep it in a ref so the measuring effect does not re-run (and re-measure,
  // and re-render) forever: that loop made the menu slow to open and sometimes not open at all.
  const anchorRef = React.useRef(anchor);
  anchorRef.current = anchor;

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchorRef.current()?.getBoundingClientRect();
      if (!rect) return;
      const vh = window.innerHeight;
      const next: Box =
        placement === "above-start"
          ? { left: rect.left, bottom: vh - rect.top + 8, width: rect.width }
          : placement === "right-end"
            ? { left: rect.right + 8, bottom: vh - rect.bottom, width: rect.width }
            : { left: rect.left, top: rect.bottom + 8, width: rect.width };
      // Same numbers: keep the old object, so React does not render again.
      setBox((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom && prev.width === next.width ? prev : next));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, placement]);

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
