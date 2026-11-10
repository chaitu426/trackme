import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { WebVitalSummary } from "@trackme/analytics";

/** The share of Core Web Vitals samples rated good, as one cell of a metric strip. */
export function VitalsPulse({ vitals, href }: { vitals: WebVitalSummary[]; href: string }) {
  const samples = vitals.reduce((total, vital) => total + vital.totalSamples, 0);
  const good = vitals.reduce((total, vital) => total + vital.goodCount, 0);
  const score = samples > 0 ? Math.round((good / samples) * 100) : null;
  const tone = score === null ? "text-zinc-500" : score >= 90 ? "text-good" : score >= 75 ? "text-warn" : "text-bad";

  return (
    <Link href={href} className="group flex flex-col gap-4 p-5 transition-colors hover:bg-white/[0.02]">
      <span className="flex items-center justify-between text-sm text-zinc-400">
        Web Vitals
        <ArrowUpRight className="h-4 w-4 text-zinc-600 transition-colors group-hover:text-zinc-300" />
      </span>
      <p className="text-[28px] font-medium leading-8 text-zinc-50 tabular-nums">{score === null ? "–" : `${score}%`}</p>
      <p className="text-xs leading-4 text-zinc-500">
        {score === null ? (
          "No samples yet"
        ) : (
          <>
            <span className={`font-mono ${tone}`}>{score >= 90 ? "Good" : score >= 75 ? "Needs work" : "Poor"}</span>{" "}
            · {samples.toLocaleString()} samples
          </>
        )}
      </p>
    </Link>
  );
}
