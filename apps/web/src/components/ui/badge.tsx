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
    default: "border border-white/10 bg-white/[0.04] text-zinc-300",
    success: "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    warning: "border border-amber-500/20 bg-amber-500/10 text-amber-400",
    outline: "border border-white/10 bg-transparent text-zinc-400",
    live: "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-mono",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${variantStyles[variant] ?? variantStyles.default} ${className}`}
    >
      {children}
    </span>
  );
}
