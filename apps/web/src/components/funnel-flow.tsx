import { formatNumber, formatPercent } from "@/lib/format";

export interface FlowStep {
  label: string;
  n: number;
  hint: string;
}

/**
 * The checkout funnel as aligned rows: the step's name on the left, a bar that is a share of the first step in the middle, and
 * the count and its share in two right-aligned columns. Between two rows, a quiet line says how many were lost. The last step
 * (the payment) is the accent; the steps before it are neutral. Plain HTML on a grid, so every column lines up at any width.
 */
export function FunnelFlow({ steps }: { steps: FlowStep[] }) {
  const top = steps[0]?.n || 1;
  return (
    <ol className="text-sm">
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const last = i === steps.length - 1;
        const share = (s.n / top) * 100;
        const lost = prev ? prev.n - s.n : 0;
        return (
          <li key={s.label}>
            {prev && (
              <div className="grid grid-cols-1 gap-x-4 py-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5rem_4.5rem]" aria-hidden={lost === 0}>
                <span />
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="h-px w-3 bg-white/[0.14]" />
                  {lost > 0 ? `${formatNumber(lost)} left here (${formatPercent((lost / (prev.n || 1)) * 100)} of the step before)` : "No one left here"}
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_5rem_4.5rem]">
              <div className="min-w-0">
                <p className="truncate text-zinc-100">{s.label}</p>
                <p className="truncate text-xs text-zinc-500">{s.hint}</p>
              </div>
              <div className="h-8 rounded-md bg-white/[0.05]" aria-hidden="true">
                <div className={`grow-x h-8 rounded-md ${last ? "bg-zinc-100" : "bg-zinc-600"}`} style={{ width: `${Math.max(s.n > 0 ? 0.8 : 0, share)}%`, ["--i" as string]: i }} />
              </div>
              <p className="text-right font-mono text-base tabular-nums text-zinc-50">{formatNumber(s.n)}</p>
              <p className="text-right font-mono text-xs tabular-nums text-zinc-500">{formatPercent(share)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
