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
    ghost: "text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100",
    secondary: "bg-zinc-100 hover:bg-zinc-200 text-zinc-700",
    outline: "border border-zinc-200 hover:bg-zinc-50 text-zinc-700",
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
          <Check className="w-3.5 h-3.5 text-emerald-600 animate-in zoom-in-50 duration-150" />
          <span className="text-emerald-700 text-[11px] font-semibold">Copied</span>
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
