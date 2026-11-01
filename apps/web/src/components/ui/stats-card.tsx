import { AnimatedNumber, type NumberFormat } from "./animated-number";
import { Card } from "./card";
import { cn } from "@/lib/utils";

export interface StatsCardProps {
  title: string;
  value: string | number;
  /** Signed change, like "+12%". Shown with what it is compared to. */
  change?: string | undefined;
  isPositive?: boolean;
  /** What the change is measured against. */
  compareTo?: string;
  subtitle?: string;
  /** The figure as a number: when given, it eases from its previous value on change. */
  numericValue?: number;
  valueFormat?: NumberFormat;
  className?: string;
}

/** A label, a figure and its change. Nothing else, so the figure is what the eye lands on. */
export function StatsCard({
  title,
  value,
  change,
  isPositive,
  compareTo = "vs previous period",
  subtitle,
  numericValue,
  valueFormat,
  className,
}: StatsCardProps) {
  return (
    <Card className={cn("flex flex-col gap-4 p-5", className)}>
      <span className="text-sm text-zinc-400">{title}</span>

      <p className="text-[28px] font-medium leading-8 text-zinc-50 tabular-nums">
        {numericValue !== undefined ? (
          <AnimatedNumber id={title} value={numericValue} {...(valueFormat ? { kind: valueFormat } : {})} />
        ) : (
          value
        )}
      </p>

      {(change || subtitle) && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs leading-4 text-zinc-500">
          {change && (
            <span className={cn("font-mono tabular-nums", isPositive ? "text-[#4cc38a]" : "text-[#e5484d]")}>
              {change}
            </span>
          )}
          {change ? <span>{compareTo}</span> : <span>{subtitle}</span>}
        </p>
      )}
    </Card>
  );
}
