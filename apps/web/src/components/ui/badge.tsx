import type { ReactNode } from "react";

export function Badge({
  variant = "default",
  children,
  className = "",
}: {
  variant?: "default" | "success" | "warning" | "outline" | "live";
  children: ReactNode;
  className?: string;
}) {
  const variantStyles: Record<string, string> = {
    default: "border border-border bg-white/[0.04] text-zinc-300",
    success: "border border-border bg-white/[0.04] text-good",
    warning: "border border-border bg-white/[0.04] text-warn",
    outline: "border border-border bg-transparent text-zinc-400",
    live: "border border-border bg-white/[0.04] font-mono text-zinc-200",
  };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-md px-2 py-0.5 text-xs font-normal ${variantStyles[variant] ?? variantStyles.default} ${className}`}
    >
      {children}
    </span>
  );
}
