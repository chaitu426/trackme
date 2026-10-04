import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { WebVitalSummary } from "@trackme/analytics";
import { Sparkline } from "@/components/ui/sparkline";

export function VitalsPulse({ vitals, href }: { vitals: WebVitalSummary[]; href: string }) {
  const samples = vitals.reduce((total, vital) => total + vital.totalSamples, 0);
  const good = vitals.reduce((total, vital) => total + vital.goodCount, 0);
  const score = samples > 0 ? Math.round((good / samples) * 100) : null;
  const spark = vitals.map((vital) =>
    vital.totalSamples > 0 ? Math.round((vital.goodCount / vital.totalSamples) * 100) : 0,
  );

  return (
    <div className="group relative flex min-h-[142px] flex-col justify-between gap-3 p-4 sm:p-4.5 transition-all duration-200 hover:border-white/[0.16] hover:bg-[#0e0f16]/95">
      {/* Top row: Left-anchored title & Right-anchored quick link */}
      <div className="flex items-start justify-between gap-2 w-full text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 select-none font-sans">
          Core Web Vitals
        </span>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-zinc-100"
        >
          <span>Report</span>
          <ArrowUpRight className="h-2.5 w-2.5" />
        </Link>
      </div>

      {/* Main Metric Value */}
      <div className="min-w-0 text-left">
        <div className="flex items-baseline gap-2">
          <p className="text-[26px] sm:text-[28px] font-bold leading-none tracking-[-0.03em] text-zinc-50 tabular-nums">
            {score === null ? "—" : `${score}%`}
          </p>
          {score !== null && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wider ${
                score >= 90
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : score >= 75
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
              }`}
            >
              {score >= 90 ? "Healthy" : score >= 75 ? "Needs work" : "Poor"}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400 font-normal leading-normal">
          {score === null ? "No RUM samples yet" : `${samples.toLocaleString()} samples rated good`}
        </p>
      </div>

      {/* Bottom sparkline */}
      {spark.length > 1 ? (
        <div className="mt-auto pt-1">
          <Sparkline values={spark} color="#22c55e" variant="bar" />
        </div>
      ) : (
        <div className="h-7" />
      )}
    </div>
  );
}
