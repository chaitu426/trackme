"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A destructive action that asks once, in place. The icon button turns into "Cancel / Remove" beside it, so the person never
 * leaves the row and no browser dialog interrupts. It disarms itself after a few seconds so a stray earlier click cannot
 * leave a live "Remove" waiting. Escape cancels.
 */
export function ConfirmAction({
  icon: Icon,
  title,
  confirmLabel,
  onConfirm,
  busy = false,
  disabled = false,
  tone = "danger",
  className,
}: {
  icon: LucideIcon;
  /** Accessible name of the icon button, e.g. "Remove member". */
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "danger" | "neutral";
  className?: string;
}) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  return (
    <div className={cn("flex items-center", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {armed ? (
          <motion.div key="armed" className="flex items-center gap-1" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.16 }}>
            <button type="button" onClick={() => setArmed(false)} className="press h-8 rounded-md px-2.5 text-xs text-zinc-400 hover:text-zinc-100">
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => {
                setArmed(false);
                onConfirm();
              }}
              className={cn("press h-8 rounded-md px-2.5 text-xs font-medium", tone === "danger" ? "bg-[#e5484d]/15 text-[#e5484d] hover:bg-[#e5484d]/25" : "bg-white/[0.08] text-zinc-100 hover:bg-white/[0.14]")}
            >
              {confirmLabel}
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="idle"
            type="button"
            title={title}
            aria-label={title}
            disabled={disabled || busy}
            onClick={() => setArmed(true)}
            className={cn("press grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-white/[0.06] disabled:opacity-40", tone === "danger" ? "hover:text-[#e5484d]" : "hover:text-zinc-100")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
