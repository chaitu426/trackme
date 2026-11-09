"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CopyButtonProps {
  text: string;
  label?: string | undefined;
  className?: string | undefined;
  variant?: "ghost" | "secondary" | "outline" | undefined;
}

/**
 * Copies text and says so: the icon turns into a check that draws itself, the label changes to "Copied" and both return after
 * two seconds. Same sizes and variants as Button, so it sits in a row of buttons without a mismatch.
 */
export function CopyButton({ text, label, className, variant = "secondary" }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const done = () => {
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    done();
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : label ? `Copy: ${label}` : "Copy to clipboard"}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes.sm, "h-8", className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={copied ? "done" : "idle"} className="inline-flex items-center gap-1.5" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.12 }}>
          {copied ? (
            <>
              <Check className="text-[#4cc38a]" aria-hidden="true" />
              <span className="text-[#4cc38a]">Copied</span>
            </>
          ) : (
            <>
              <Copy aria-hidden="true" />
              {label && <span>{label}</span>}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
