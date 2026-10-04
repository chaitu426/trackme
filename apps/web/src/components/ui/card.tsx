import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-white/[0.08] bg-[#0c0d12]/90 backdrop-blur-md shadow-sm transition-all duration-200 hover:border-white/[0.13] p-4 sm:p-5 text-left",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col space-y-1 text-left items-start pb-3.5", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h3
      className={cn(
        "text-[13px] sm:text-sm font-semibold tracking-[-0.01em] text-zinc-100 flex items-center gap-2 text-left",
        className
      )}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={cn("text-[11px] sm:text-xs text-zinc-400 font-normal leading-relaxed text-left", className)}>
      {children}
    </p>
  );
}

export function CardContent({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("pt-0 text-left", className)}>{children}</div>;
}

export function CardFooter({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center pt-3 border-t border-white/[0.06] text-left", className)}>
      {children}
    </div>
  );
}
