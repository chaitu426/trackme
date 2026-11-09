import type { DailyPoint } from "@trackme/analytics";
import { formatMoney } from "@/lib/payments-view";

/** Revenue per day as bars. Plain SVG, no client code: the hover text is each bar's title. */
export function RevenueBars({ points, currency }: { points: DailyPoint[]; currency: string }) {
  const max = Math.max(...points.map((p) => p.revenueMinor), 1);
  const W = 720, H = 140, gap = 3;
  const bar = (W - gap * (points.length - 1)) / Math.max(points.length, 1);
  return (
    <figure className="px-5 pb-5">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Revenue per day in ${currency}`} className="w-full">
        {points.map((p, i) => {
          const h = Math.max(p.revenueMinor > 0 ? 2 : 0, (p.revenueMinor / max) * H);
          const x = i * (bar + gap);
          return (
            <g key={p.day}>
              <title>{`${p.day}: ${formatMoney(p.revenueMinor, currency)} from ${p.paid} payment${p.paid === 1 ? "" : "s"}`}</title>
              <rect x={x} y={H - h} width={bar} height={h} rx={2} fill="#ededed" opacity={p.revenueMinor > 0 ? 0.85 : 0.15} />
            </g>
          );
        })}
        <text x={0} y={H + 14} fontSize="10" fill="#8b8b92">{points[0]?.day.slice(5)}</text>
        <text x={W} y={H + 14} fontSize="10" fill="#8b8b92" textAnchor="end">{points[points.length - 1]?.day.slice(5)}</text>
      </svg>
    </figure>
  );
}
