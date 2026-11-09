"use client";

import * as React from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Swaps one panel for the next, sliding a short way in the direction of travel (1 forward, -1 back) and fading. Waits for the
 * old panel to leave first, so two steps are never on screen at once. Position-only, so nothing reflows while it moves.
 */
export function StepPanel({ stepKey, direction = 1, children, className }: { stepKey: string | number; direction?: 1 | -1; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={stepKey}
        custom={direction}
        className={className}
        variants={{
          enter: (d: number) => ({ opacity: 0, x: d * 24 }),
          center: { opacity: 1, x: 0 },
          exit: (d: number) => ({ opacity: 0, x: d * -24 }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.16, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Children rise into place one after another, once. For a page's main blocks; use at most one per page. */
export function Stagger({ children, className, step = 0.05 }: { children: React.ReactNode; className?: string; step?: number }) {
  const items = React.Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE, delay: Math.min(i, 6) * step }}>
          {child}
        </motion.div>
      ))}
    </div>
  );
}

/** A ring and a check that draw themselves once. The one celebratory moment in a flow; it is quiet and does not loop. */
export function DrawCheck({ size = 56, tone = "ok", className }: { size?: number; tone?: "ok" | "bad"; className?: string }) {
  const color = tone === "ok" ? "#4cc38a" : "#e5484d";
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden="true" className={className}>
      <motion.circle cx="28" cy="28" r="26" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: EASE }} />
      <motion.path
        d={tone === "ok" ? "M17 29.5l7.5 7.5L39 20" : "M20 20l16 16M36 20L20 36"}
        stroke={color}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: EASE, delay: 0.35 }}
      />
    </svg>
  );
}

/** Opens and closes a block by its height. Keep it for small content: height triggers layout every frame. */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="content" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }} transition={{ duration: 0.22, ease: EASE }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A message that fades in and shakes once each time `nonce` changes, so a repeated error is noticed again. */
export function Notice({ nonce, children, className }: { nonce: number; children: React.ReactNode; className?: string }) {
  return (
    <motion.div key={nonce} role="alert" className={className} initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: [0, -6, 5, -3, 0] }} transition={{ duration: 0.38, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}

export interface PillItem<T extends string> {
  id: T;
  label: React.ReactNode;
  description?: string;
}

/**
 * A row of options with one highlight that slides to the chosen item (a shared-layout animation). Reusable for tabs, ranges and
 * roles. `kind="tabs"` renders tab semantics; `"radio"` renders a radio group.
 */
export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  kind = "tabs",
  className,
  itemClassName,
  size = "md",
}: {
  items: PillItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  kind?: "tabs" | "radio";
  className?: string;
  itemClassName?: string;
  size?: "sm" | "md";
}) {
  const group = React.useId();
  return (
    <LayoutGroup id={group}>
      <div role={kind === "tabs" ? "tablist" : "radiogroup"} aria-label={label} className={cn("flex gap-0.5 overflow-x-auto rounded-lg border border-white/[0.1] p-0.5", className)}>
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role={kind === "tabs" ? "tab" : "radio"}
              {...(kind === "tabs" ? { "aria-selected": active } : { "aria-checked": active })}
              onClick={() => onChange(item.id)}
              className={cn(
                size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
                "press relative inline-flex shrink-0 items-center justify-center rounded-md",
                active ? "font-medium text-zinc-50" : "text-zinc-400 hover:text-zinc-100",
                itemClassName
              )}
            >
              {active && (
                <motion.span layoutId="pill" className="absolute inset-0 rounded-md bg-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.28 }} />
              )}
              <span className="relative">{item.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
