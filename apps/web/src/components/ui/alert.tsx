import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CircleCheck, Info, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, { icon: LucideIcon; text: string }> = {
  info: { icon: Info, text: "text-zinc-400" },
  success: { icon: CircleCheck, text: "text-[#4cc38a]" },
  warning: { icon: AlertTriangle, text: "text-amber-400" },
  danger: { icon: OctagonAlert, text: "text-[#e5484d]" },
};

/** A callout. Colour lives in the icon only; the surface stays neutral so it never competes with the data. */
export function Alert({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  const { icon: Icon, text } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border border-border bg-white/[0.02] px-4 py-3", className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", text)} aria-hidden="true" />
      <div className="min-w-0 text-sm leading-5">
        {title && <p className="font-medium text-zinc-100">{title}</p>}
        {children && <div className={cn("text-xs leading-5 text-zinc-400", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
