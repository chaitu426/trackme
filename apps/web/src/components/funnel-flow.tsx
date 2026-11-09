import { formatNumber, formatPercent } from "@/lib/format";

export interface FlowStep {
  label: string;
  n: number;
  hint: string;
}

const W = 760;
const BAR = 56;
const GAP = 44;

/**
 * The checkout funnel as bars on a common baseline, joined by tapered bands so the eye follows the shoppers who stayed and
 * sees the gap where the others left. The last step is the accent; the earlier ones are neutral steps. Between two steps the
 * band's label says how many were lost and how much of the previous step that is.
 */
export function FunnelFlow({ steps }: { steps: FlowStep[] }) {
  const top = steps[0]?.n || 1;
  const h = steps.length * BAR + (steps.length - 1) * GAP;
  const w = (n: number) => Math.max(n > 0 ? 6 : 0, (n / top) * (W - 200));
  const cx = 200 + (W - 200) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`Checkout funnel: ${steps.map((s) => `${s.label} ${s.n}`).join(", ")}`} className="w-full">
      {steps.map((s, i) => {
        const y = i * (BAR + GAP);
        const bw = w(s.n);
        const next = steps[i + 1];
        const last = i === steps.length - 1;
        return (
          <g key={s.label}>
            {next && (
              <>
                <path
                  d={`M${cx - bw / 2},${y + BAR} L${cx + bw / 2},${y + BAR} L${cx + w(next.n) / 2},${y + BAR + GAP} L${cx - w(next.n) / 2},${y + BAR + GAP}Z`}
                  fill="rgba(237,237,237,0.06)"
                  className="fade-late"
                />
                <text x={W - 4} y={y + BAR + GAP / 2 + 4} textAnchor="end" fontSize="11" fill="#85858b" fontFamily="var(--font-mono)">
                  {s.n - next.n > 0 ? `−${formatNumber(s.n - next.n)} (${formatPercent(((s.n - next.n) / (s.n || 1)) * 100)})` : "no loss"}
                </text>
              </>
            )}
            <rect x={cx - bw / 2} y={y} width={bw} height={BAR} rx="6" fill={last ? "#ededed" : "#4a4a50"} className="fade-late" />
            <text x={0} y={y + 22} fontSize="13" fill="#ededed">{s.label}</text>
            <text x={0} y={y + 40} fontSize="11" fill="#85858b">{s.hint}</text>
            <text x={cx} y={y + BAR / 2 + 5} textAnchor="middle" fontSize="15" fontFamily="var(--font-mono)" fill={last ? "#141415" : "#ededed"}>
              {formatNumber(s.n)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
