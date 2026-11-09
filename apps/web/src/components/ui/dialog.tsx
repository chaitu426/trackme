"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A modal. The backdrop fades, the panel rises a few pixels and settles. Focus moves in on open and returns to the opener on
 * close; Tab stays inside; Escape and a click on the backdrop close it; the page behind does not scroll. Always has a title
 * (visible, since a dialog without one cannot be told apart by a screen reader).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** False while something is saving, so a stray Escape cannot abandon it. */
  dismissible?: boolean;
}) {
  const panel = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[autofocus],input,textarea,select") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && panel.current) {
        const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (nodes.length === 0) return;
        const head = nodes[0]!, tail = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === head) {
          e.preventDefault();
          tail.focus();
        } else if (!e.shiftKey && document.activeElement === tail) {
          e.preventDefault();
          head.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, dismissible, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center">
          <motion.div className="absolute inset-0 bg-black/70" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => dismissible && onClose()} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            className={cn("relative flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-xl border border-border bg-card shadow-float", size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md")}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-medium text-zinc-50">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="mt-1 text-xs leading-5 text-zinc-400">
                    {description}
                  </p>
                )}
              </div>
              {dismissible && (
                <button type="button" onClick={onClose} aria-label="Close" className="press -mr-1.5 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100">
                  <X className="size-4" />
                </button>
              )}
            </header>
            {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
            {footer && <footer className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
