import React from "react";

export function Badge({
  variant = "default",
  children,
  className = "",
}: {
  variant?: "default" | "success" | "warning" | "outline" | "live";
  children: React.ReactNode;
  className?: string;
}) {
  const variantStyles: Record<string, string> = {
    default:  "bg-zinc-100 text-zinc-700 border-zinc-200/60",
    success:  "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    warning:  "bg-amber-50 text-amber-700 border-amber-200/60",
    outline:  "border-zinc-200 text-zinc-600",
    live:     "bg-emerald-50 text-emerald-800 border-emerald-200/70 font-mono",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${variantStyles[variant] ?? variantStyles.default} ${className}`}
    >
      {children}
    </span>
  );
}
