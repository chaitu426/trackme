"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * What every overlay does the same way: focus moves in on open and returns to the opener on close, Tab stays inside, Escape
 * closes (unless `dismissible` is false, e.g. while saving), and the page behind does not scroll. One implementation, so a
 * dialog, a form modal and a side panel cannot drift apart.
 */
export function useOverlayBehavior(panel: React.RefObject<HTMLElement | null>, onClose: () => void, dismissible = true, active = true) {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[autofocus],input,textarea,select") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        close.current();
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
  }, [panel, dismissible, active]);
}

const SIZES = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" } as const;

/**
 * A centred modal whose contents you write yourself (a form with its own header and footer). Mount it only while it is open,
 * inside an `AnimatePresence` if you want it to animate out. Pass `onSubmit` to render the panel as a form.
 */
export function ModalFrame({
  onClose,
  labelledBy,
  onSubmit,
  size = "lg",
  dismissible = true,
  children,
}: {
  onClose: () => void;
  /** The id of the element that titles the dialog. */
  labelledBy: string;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  size?: keyof typeof SIZES;
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  const panel = React.useRef<HTMLElement>(null);
  useOverlayBehavior(panel, onClose, dismissible);
  const common = {
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": labelledBy,
    className: cn("relative flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-xl border border-border bg-card shadow-float", SIZES[size]),
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 8, scale: 0.98 },
    transition: { duration: 0.2, ease: EASE },
  } as const;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center">
      <motion.div className="absolute inset-0 bg-black/70" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={() => dismissible && onClose()} />
      {onSubmit ? (
        <motion.form ref={panel as React.RefObject<HTMLFormElement>} onSubmit={onSubmit} {...common}>
          {children}
        </motion.form>
      ) : (
        <motion.div ref={panel as React.RefObject<HTMLDivElement>} {...common}>
          {children}
        </motion.div>
      )}
    </div>
  );
}

/** A panel that slides in from the right (a profile, a detail view). Same focus, Escape and scroll behaviour as every overlay. */
export function SidePanelFrame({ onClose, label, children, width = "max-w-xl" }: { onClose: () => void; label: string; children: React.ReactNode; width?: string }) {
  const panel = React.useRef<HTMLElement>(null);
  useOverlayBehavior(panel, onClose);
  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <motion.div className="absolute inset-0 bg-black/60" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={onClose} />
      <motion.aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn("relative flex h-full w-full flex-col border-l border-border bg-card shadow-float", width)}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", bounce: 0, visualDuration: 0.32 }}
      >
        {children}
      </motion.aside>
    </div>
  );
}

/**
 * A modal with a standard header (title, description, close), body and footer. Use it for most dialogs; use ModalFrame when a
 * screen needs its own layout. Always has a visible title: a dialog without one cannot be told apart by a screen reader.
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
  size?: keyof typeof SIZES;
  /** False while something is saving, so a stray Escape cannot abandon it. */
  dismissible?: boolean;
}) {
  const titleId = React.useId();
  const descId = React.useId();
  return (
    <AnimatePresence>
      {open && (
        <ModalFrame onClose={onClose} labelledBy={titleId} size={size} dismissible={dismissible}>
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
        </ModalFrame>
      )}
    </AnimatePresence>
  );
}

/**
 * A yes or no question for an action that cannot be undone. Say what will be lost in `description`; the confirm button names the
 * action ("Remove website"), not "OK". Stays open and shows a spinner while the action runs.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  loading = false,
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  loading?: boolean;
  tone?: "danger" | "primary";
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!loading}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
