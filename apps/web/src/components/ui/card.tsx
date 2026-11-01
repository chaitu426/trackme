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
    <div className={cn("relative rounded-xl border border-border bg-card p-5 text-left", className)}>
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
    <div className={cn("flex flex-col items-start space-y-1 pb-4 text-left", className)}>
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
    <h3 className={cn("flex items-center gap-2 text-left text-sm font-medium text-zinc-100", className)}>
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
  return <p className={cn("text-left text-xs leading-4 text-zinc-400", className)}>{children}</p>;
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
    <div className={cn("flex items-center border-t border-border pt-4 text-left", className)}>
      {children}
    </div>
  );
}
