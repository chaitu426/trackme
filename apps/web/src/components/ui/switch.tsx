"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-describedby"?: string | undefined;
}

/**
 * On is the bright state: a light track with a dark thumb, so a row of switches reads at a glance on the dark page.
 * Off is a quiet hairline track. The thumb travels on a no-bounce spring, and a press squeezes it slightly.
 */
export function Switch({ checked, onCheckedChange, disabled = false, id, className, "aria-label": ariaLabel, "aria-describedby": describedBy }: SwitchProps) {
  const isDisabled = Boolean(disabled);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      id={id}
      disabled={isDisabled}
      onClick={() => !isDisabled && onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141415]",
        checked ? "border-transparent bg-[#ededed]" : "border-white/[0.14] bg-white/[0.05]",
        isDisabled && "cursor-not-allowed opacity-40",
        className
      )}
    >
      <motion.span
        aria-hidden="true"
        className={cn("pointer-events-none block size-3.5 rounded-full", checked ? "bg-[#141415]" : "bg-zinc-400")}
        initial={false}
        animate={{ x: checked ? 18 : 3 }}
        {...(isDisabled ? {} : { whileTap: { scaleX: 1.25 } })}
        transition={{ type: "spring", bounce: 0, visualDuration: 0.2 }}
      />
    </button>
  );
}
