"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { strengthLabel, type PasswordReport } from "@/lib/password-meter";
import { cn } from "@/lib/utils";

/**
 * Live feedback under a new-password field: a bar that grows and changes colour with strength, and the rules as a checklist whose
 * ticks fill in as they are met. Used wherever a password is chosen (sign up, accepting an invitation), so the rules read the same.
 */
export function PasswordMeter({ report, id = "password-meter" }: { report: PasswordReport; id?: string }) {
  return (
    <div id={id} className="mt-1">
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
          <motion.div
            className={cn("h-full origin-left rounded-full", report.strength < 0.4 ? "bg-bad" : report.strength < 0.75 ? "bg-warn" : "bg-good")}
            animate={{ scaleX: report.strength }}
            initial={false}
            transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
            style={{ width: "100%" }}
          />
        </div>
        <span className="w-12 text-right text-xs text-zinc-500">{strengthLabel(report.strength)}</span>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {report.checks.map((c) => (
          <li key={c.id} className={cn("flex items-center gap-2 text-xs transition-colors duration-150", c.ok ? "text-zinc-300" : "text-zinc-500")}>
            <span className={cn("grid size-3.5 place-items-center rounded-full border transition-colors duration-150", c.ok ? "border-good/60 text-good" : "border-white/[0.14]")}>
              {c.ok && <Check className="size-2.5" aria-hidden="true" />}
            </span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
