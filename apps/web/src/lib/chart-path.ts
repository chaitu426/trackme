export interface Pt {
  x: number;
  y: number;
}

/**
 * A smooth line through the points that never overshoots them (monotone cubic, Fritsch-Carlson). A plain spline would dip
 * below zero after a spike, which on a revenue chart reads as negative revenue.
 */
export function smoothPath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0]!.x},${points[0]!.y}`;
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push(dx[i]! === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx[i]!);
  }
  const tangent: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    tangent.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / slope[i]!, b = tangent[i + 1]! / slope[i]!;
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]!) / h;
      tangent[i + 1] = (3 * b * slope[i]!) / h;
    }
  }
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(points[0]!.x)},${f(points[0]!.y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i]! / 3;
    d += `C${f(points[i]!.x + h)},${f(points[i]!.y + tangent[i]! * h)} ${f(points[i + 1]!.x - h)},${f(points[i + 1]!.y - tangent[i + 1]! * h)} ${f(points[i + 1]!.x)},${f(points[i + 1]!.y)}`;
  }
  return d;
}

/** A "nice" axis maximum at or above `max`: 1, 2, 2.5, 5 times a power of ten. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/** Index of the point nearest to x in a chart of `count` evenly spaced points across `width`. */
export function nearestIndex(x: number, width: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((x / width) * (count - 1))));
}
