import * as React from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The one text-input look: hairline border, a small surface step on focus, red hairline when invalid. */
export const inputClass =
  "h-10 w-full rounded-lg border border-border bg-white/[0.03] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 " +
  "transition-colors duration-[120ms] hover:border-white/[0.14] focus:border-white/[0.28] focus:bg-white/[0.05] focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[#e5484d]/70";

export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-5", className)}>{children}</div>;
}

/** Label, control, then help or error text. `invalid` puts the message in red and is read out by screen readers. */
export function Field({
  label,
  htmlFor,
  description,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  description?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-invalid={error ? "true" : undefined}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-zinc-300">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-[#e5484d]">
          {error}
        </p>
      ) : (
        description && (
          <p id={`${htmlFor}-hint`} className="text-xs text-zinc-500">
            {description}
          </p>
        )
      )}
    </div>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(inputClass, className)} {...props} />;
});

/** A keyboard key, for shortcuts and hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">{children}</kbd>;
}
