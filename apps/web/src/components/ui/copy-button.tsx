"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";

export interface CopyButtonProps {
  text: string;
  label?: string | undefined;
  className?: string | undefined;
  variant?: "ghost" | "secondary" | "outline" | undefined;
}

export function CopyButton({
  text,
  label,
  className = "",
  variant = "secondary",
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const variantStyles = {
    ghost: "text-zinc-400 hover:text-zinc-50 hover:bg-white/[0.04]",
    secondary: "bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300",
    outline: "border border-white/10 hover:bg-white/[0.03] text-zinc-300",
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className={`
        inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
        transition duration-150 ease-in-out cursor-pointer active:scale-95
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400 animate-in zoom-in-50 duration-150" />
          <span className="text-emerald-400 text-[11px] font-semibold">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 shrink-0" />
          {label && <span className="text-[11px]">{label}</span>}
        </>
      )}
    </button>
  );
}
