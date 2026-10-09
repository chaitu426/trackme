import * as React from "react";

/** Sample series for the preview chart. Not real data, and labelled as such on the page. */
const SERIES = [18, 22, 20, 27, 31, 29, 36, 40, 38, 46, 52, 49, 57, 61, 58, 66, 72, 69, 78, 84, 80, 88, 95, 91];

function chartPaths(values: number[], width: number, height: number, pad = 6) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  // Smooth the line with midpoint quadratic curves.
  let line = `M${points[0]![0].toFixed(1)} ${points[0]![1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]!;
    const [x, y] = points[i]!;
    const mx = (px + x) / 2;
    const my = (py + y) / 2;
    line += ` Q${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = points[points.length - 1]!;
  line += ` T${last[0].toFixed(1)} ${last[1].toFixed(1)}`;

  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return { line, area };
}

const STATS = [
  { label: "Visitors", value: "12,480", delta: "+8.2%", good: true },
  { label: "Pageviews", value: "39,206", delta: "+11.4%", good: true },
  { label: "Bounce rate", value: "34.1%", delta: "−2.0 pts", good: true },
  { label: "Avg. session", value: "2m 48s", delta: "+6s", good: true },
];

const PAGES = [
  { name: "/", value: 4210, share: 100 },
  { name: "/pricing", value: 2630, share: 62 },
  { name: "/docs/quickstart", value: 1880, share: 45 },
  { name: "/blog/launch-notes", value: 940, share: 22 },
];

const SOURCES = [
  { name: "Google", value: 3920, share: 100 },
  { name: "Direct", value: 2710, share: 69 },
  { name: "GitHub", value: 1460, share: 37 },
  { name: "Newsletter", value: 820, share: 21 },
];

function Bars({ title, rows }: { title: string; rows: { name: string; value: number; share: number }[] }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
      <p className="mb-3 text-xs font-medium text-zinc-300">{title}</p>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.name} className="relative">
            <div className="absolute inset-y-0 left-0 rounded bg-blue-500/10" style={{ width: `${row.share}%` }} />
            <div className="relative flex items-center justify-between px-2 py-1 text-xs">
              <span className="truncate font-mono text-zinc-300">{row.name}</span>
              <span className="tabular-nums text-zinc-400">{row.value.toLocaleString("en-US")}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A static illustration of the dashboard. Everything in it is sample data. */
export function ProductPreview() {
  const { line, area } = chartPaths(SERIES, 640, 150);

  return (
    <div
      role="img"
      aria-label="Illustration of the TrackMe overview dashboard with sample data: four headline metrics, a visitors chart, top pages and top sources."
      className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          </span>
          <span className="text-xs text-zinc-400">Overview · Last 7 days</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
            <span className="pulse-live h-1 w-1 rounded-full bg-emerald-400" />
            Live
          </span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
            Sample data
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3.5">
              <p className="text-[11px] text-zinc-500">{stat.label}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-zinc-50 tabular-nums">{stat.value}</p>
              <p className={`mt-0.5 text-[11px] font-medium ${stat.good ? "text-emerald-400" : "text-rose-400"}`}>
                {stat.delta}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
          <p className="mb-2 text-xs font-medium text-zinc-300">Visitors</p>
          <svg viewBox="0 0 640 150" className="h-36 w-full" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="landing-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                x2="640"
                y1={150 * fraction}
                y2={150 * fraction}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
            ))}
            <path d={area} fill="url(#landing-area)" />
            <path d={line} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Bars title="Top pages" rows={PAGES} />
          <Bars title="Top sources" rows={SOURCES} />
        </div>
      </div>
    </div>
  );
}
