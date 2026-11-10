"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info, X } from "lucide-react";
import { DrawCheck } from "@/components/motion/primitives";
import { TOAST_EVENT, toastDuration, type ToastInput } from "@/lib/toast";

interface Item extends ToastInput {
  id: number;
}

const MAX_VISIBLE = 3;

/**
 * The one place confirmations and errors appear: bottom right, newest at the bottom, at most three at once. A toast leaves by
 * itself, stays while the pointer is on it, and can be dismissed. Success draws a check; errors are announced assertively.
 */
export function Toaster() {
  const [items, setItems] = React.useState<Item[]>([]);
  const next = React.useRef(1);
  const timers = React.useRef(new Map<number, number>());

  const dismiss = React.useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const arm = React.useCallback(
    (item: Item) => {
      window.clearTimeout(timers.current.get(item.id));
      timers.current.set(item.id, window.setTimeout(() => dismiss(item.id), toastDuration(item)));
    },
    [dismiss]
  );

  React.useEffect(() => {
    const onToast = (e: Event) => {
      const item: Item = { ...(e as CustomEvent<ToastInput>).detail, id: next.current++ };
      setItems((list) => [...list.slice(-(MAX_VISIBLE - 1)), item]);
      arm(item);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    const active = timers.current;
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      active.forEach((t) => window.clearTimeout(t));
    };
  }, [arm]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout="position"
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-raised px-4 py-3 shadow-float"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onPointerEnter={() => window.clearTimeout(timers.current.get(t.id))}
            onPointerLeave={() => arm(t)}
          >
            <span className="mt-0.5 shrink-0">
              {t.tone === "success" ? <DrawCheck size={18} /> : t.tone === "error" ? <DrawCheck size={18} tone="bad" /> : <Info className="size-[18px] text-zinc-400" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-50">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs leading-5 text-zinc-400">{t.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="press -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 hover:text-zinc-100">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
