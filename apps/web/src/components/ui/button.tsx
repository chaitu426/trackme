import * as React from "react";
import { MatrixSpinner } from "@/components/ui/matrix-loader";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/** The one button look. `primary` is the single bright action on a screen; everything else steps down in weight. */
export const buttonVariants: Record<Variant, string> = {
  primary: "bg-[#ededed] text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white",
  secondary: "border border-border bg-raised text-zinc-100 hover:border-white/[0.18] hover:bg-[#2a2a2d]",
  outline: "border border-border bg-transparent text-zinc-300 hover:border-white/[0.2] hover:text-zinc-50",
  ghost: "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
  danger: "bg-[#e5484d]/[0.12] text-[#e5484d] hover:bg-[#e5484d]/[0.22]",
};

export const buttonSizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
  md: "h-9 gap-2 rounded-lg px-4 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-sm",
};

export const buttonBase =
  "press inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141415] " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner in place of the icon, disables the button and keeps its width so nothing around it moves. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className, children, disabled, type = "button", ...props },
  ref
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props}>
      {loading && <MatrixSpinner />}
      {children}
    </button>
  );
});

/** A square button holding one icon. `label` is its accessible name and its tooltip text. */
export const IconButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, "children" | "size"> & { label: string; icon: React.ReactNode; size?: "sm" | "md" }>(function IconButton(
  { label, icon, variant = "ghost", size = "md", className, ...props },
  ref
) {
  return (
    <Button ref={ref} variant={variant} aria-label={label} title={label} className={cn("p-0", size === "sm" ? "size-8" : "size-9", className)} {...props}>
      {icon}
    </Button>
  );
});
