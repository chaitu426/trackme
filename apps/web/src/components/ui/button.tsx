import React from "react";

export function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  const base =
    "inline-flex items-center justify-center font-semibold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 disabled:pointer-events-none disabled:opacity-50";

  const variants: Record<string, string> = {
    primary:   "bg-zinc-900 hover:bg-zinc-800 text-white shadow-xs",
    secondary: "bg-zinc-100 hover:bg-zinc-200 text-zinc-800",
    outline:   "border border-zinc-200 hover:border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-700",
    ghost:     "hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900",
    danger:    "text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200",
  };

  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 text-xs",
    lg: "h-10 px-5 text-sm",
  };

  return (
    <button className={`${base} ${variants[variant] ?? variants.primary} ${sizes[size] ?? sizes.md} ${className}`} {...props}>
      {children}
    </button>
  );
}
