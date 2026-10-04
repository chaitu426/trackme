"use client";

type SparklineProps = {
  values: number[];
  className?: string;
  color?: string;
  strokeWidth?: number;
  /** If true, renders as mini bar chart instead of a line */
  variant?: "line" | "bar";
};

export function Sparkline({
  values,
  className = "",
  color = "var(--sparkline)",
  strokeWidth = 1.5,
  variant = "bar",
}: SparklineProps) {
  if (values.length < 2) {
    return <div className={`h-8 w-full ${className}`} />;
  }

  const width = 120;
  const height = 32;

  if (variant === "bar") {
    const max = Math.max(...values, 1);
    const barCount = values.length;
    const gap = 1;
    const barW = Math.max(1, (width - gap * (barCount - 1)) / barCount);

    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`h-8 w-full overflow-visible ${className}`}
        aria-hidden
      >
        {values.map((value, index) => {
          const barH = Math.max(2, (value / max) * height);
          const x = index * (barW + gap);
          const y = height - barH;
          const opacity = 0.35 + 0.65 * (value / max);
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={1}
              fill={color}
              opacity={opacity}
            />
          );
        })}
      </svg>
    );
  }

  // Line variant
  const padY = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  const pts = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - padY - ((value - min) / range) * (height - padY * 2);
    return { x, y };
  });

  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-8 w-full overflow-visible ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={`sg-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#sg-${color.replace(/[^a-z0-9]/gi, "")})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
