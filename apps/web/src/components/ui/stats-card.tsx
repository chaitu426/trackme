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

/** A long figure (a price with a symbol and decimals) steps down a size so it never touches the card edge. */
function figureSize(text: string): string {
  const n = text.length;
  // Most figures share one size so a row of cards lines up; only one that would not fit steps down.
  return n > 13 ? "text-[20px]" : n > 11 ? "text-[24px]" : "text-[28px]";
}

/**
 * A label, a figure and its change, in three fixed rows. Every card in a row has the same row heights, so labels, figures and
 * changes line up across cards even when one label is longer or one card has no change. Nothing wraps: a label that does not
 * fit is cut (the full text is in its tooltip), and the change line is one line.
 */
export function StatsCard({ title, value, change, isPositive, compareTo = "vs previous period", subtitle, numericValue, valueFormat, className }: StatsCardProps) {
  const shown = typeof value === "number" ? String(value) : value;
  return (
    <Card className={cn("grid min-w-0 grid-rows-[20px_36px_16px] content-start gap-y-3 p-5", className)}>
      <span title={title} className="truncate text-sm leading-5 text-zinc-400">
        {title}
      </span>

      <p className={cn("flex items-end overflow-hidden whitespace-nowrap font-medium leading-9 tracking-[-0.01em] text-zinc-50 tabular-nums", figureSize(shown))}>
        {numericValue !== undefined ? <AnimatedNumber id={title} value={numericValue} {...(valueFormat ? { kind: valueFormat } : {})} /> : value}
      </p>

      <p className="flex min-w-0 items-baseline gap-x-2 whitespace-nowrap text-xs leading-4 text-zinc-500">
        {change ? (
          <>
            <span className={cn("shrink-0 font-mono tabular-nums", isPositive ? "text-good" : "text-bad")}>{change}</span>
            <span className="truncate">{compareTo}</span>
          </>
        ) : (
          <span className="truncate">{subtitle ?? ""}</span>
        )}
      </p>
    </Card>
  );
}
