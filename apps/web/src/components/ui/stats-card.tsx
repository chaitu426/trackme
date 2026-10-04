import { Sparkline } from "./sparkline";
import { Card } from "./card";
import { cn } from "@/lib/utils";

export interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string | undefined;
  isPositive?: boolean;
  subtitle?: string;
  badge?: string;
  sparkline?: number[];
  sparklineColor?: string;
  sparklineVariant?: "bar" | "line";
  className?: string;
}

export function StatsCard({
  title,
  value,
  change,
  isPositive,
  subtitle,
  badge,
  sparkline,
  sparklineColor,
  sparklineVariant = "bar",
  className,
}: StatsCardProps) {
  return (
    <Card
      className={cn(
        "group relative flex min-h-[142px] flex-col justify-between gap-3 p-4 sm:p-4.5 transition-all duration-200 hover:border-white/[0.16] hover:bg-[#0e0f16]/95 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]",
        className
      )}
    >
      {/* Top row: Left-anchored title & Right-anchored badge/delta */}
      <div className="flex items-start justify-between gap-2 w-full text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 select-none font-sans">
          {title}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
              {badge}
            </span>
          )}
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums border",
                isPositive
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                  : "border-rose-500/25 bg-rose-500/10 text-rose-400"
              )}
            >
              <span>{isPositive ? "↑" : "↓"}</span>
              <span>{change.replace(/^[+-]/, "")}</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Metric Value */}
      <div className="min-w-0 text-left">
        <p className="text-[26px] sm:text-[28px] font-bold leading-none tracking-[-0.03em] text-zinc-50 tabular-nums">
          {value}
        </p>
        {subtitle && (
          <p className="mt-1.5 text-[11px] text-zinc-400 font-normal leading-normal">
            {subtitle}
          </p>
        )}
      </div>

      {/* Bottom Sparkline visualization */}
      {sparkline && sparkline.length > 1 ? (
        <div className="mt-auto pt-1">
          <Sparkline
            values={sparkline}
            color={sparklineColor ?? "var(--sparkline)"}
            className="w-full"
            variant={sparklineVariant}
          />
        </div>
      ) : (
        <div className="h-7" />
      )}
    </Card>
  );
}
