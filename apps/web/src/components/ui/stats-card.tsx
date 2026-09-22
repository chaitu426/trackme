import React from "react";
import { Card } from "./card.js";

export interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string | undefined;
  isPositive?: boolean;
  subtitle?: string;
  badge?: string;
}

export function StatsCard({
  title,
  value,
  change,
  isPositive,
  subtitle,
  badge,
}: StatsCardProps) {
  return (
    <Card className="flex flex-col justify-between min-h-[120px]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-zinc-500">{title}</span>
        {badge && (
          <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>

      <div className="flex items-baseline space-x-2.5">
        <span className="text-2xl font-bold tracking-tight text-zinc-900 font-mono">
          {value}
        </span>
        {change && (
          <span
            className={`inline-flex items-center space-x-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md border ${
              isPositive
                ? "text-emerald-600 bg-emerald-50 border-emerald-200/60"
                : "text-rose-600 bg-rose-50 border-rose-200/60"
            }`}
          >
            <span>{isPositive ? "↑" : "↓"}</span>
            <span>{change}</span>
          </span>
        )}
      </div>

      {subtitle && (
        <p className="text-[11px] text-zinc-400 mt-2 pt-2 border-t border-zinc-100">
          {subtitle}
        </p>
      )}
    </Card>
  );
}
