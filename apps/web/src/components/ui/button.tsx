import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50";

  const variants: Record<string, string> = {
    primary: "bg-zinc-100 hover:bg-white text-zinc-950",
    secondary: "bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200",
    outline: "border border-white/10 hover:border-white/20 bg-transparent hover:bg-white/[0.04] text-zinc-300",
    ghost: "hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-100",
    danger: "text-rose-400 hover:bg-rose-500/10 border border-transparent",
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
