import { cn } from "@/lib/utils";

/** The plan's name in the product's type: mono, uppercase, with a two-glyph mark that is denser on Pro. */
export function PlanBadge({ plan, className }: { plan: string; className?: string }) {
  const pro = plan === "pro";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase leading-4 tracking-[0.14em]",
        pro ? "border-white/[0.28] bg-white/[0.07] text-zinc-50" : "border-border text-zinc-400",
        className
      )}
    >
      <span aria-hidden="true" className={pro ? "text-zinc-50" : "text-zinc-500"}>
        {pro ? "##" : ".:"}
      </span>
      {pro ? "Pro" : "Free"}
    </span>
  );
}
