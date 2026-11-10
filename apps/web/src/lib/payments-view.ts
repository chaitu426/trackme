import type { CurrencySummary, DailyPoint } from "@trackme/analytics";
import type { RangeKey } from "./date-range";

const DAY = 86_400_000;
const RANGE_DAYS: Record<RangeKey, number> = { "24h": 1, "7d": 7, "30d": 30 };

/** Inclusive UTC date ranges for the chosen window and the window just before it (same length), for period-over-period change. */
export function paymentRanges(range: RangeKey, now: Date = new Date()) {
  const days = RANGE_DAYS[range];
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const end = now.getTime();
  return {
    days,
    current: { from: day(end - (days - 1) * DAY), to: day(end) },
    previous: { from: day(end - (2 * days - 1) * DAY), to: day(end - days * DAY) },
  };
}

/** How many minor units make one major unit, from the currency itself (JPY 1, USD 100, KWD 1000). */
export function minorDivisor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

/** `compact` shortens large figures for cards ("₹2.4L" style is locale specific, so this uses K/M). */
export function formatMoney(minor: number, currency: string, compact = false): string {
  const major = minor / minorDivisor(currency);
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      ...(compact && Math.abs(major) >= 10_000 ? { notation: "compact" as const, maximumFractionDigits: 1 } : {}),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

/** Percent change, or null when there is nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

export const rate = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

/** The currency to show: the requested one if it has data, else the one with the most revenue. */
export function chooseCurrency(currencies: CurrencySummary[], requested: string | undefined): CurrencySummary | null {
  if (currencies.length === 0) return null;
  return currencies.find((c) => c.currency === requested?.toUpperCase()) ?? [...currencies].sort((a, b) => b.revenueMinor - a.revenueMinor)[0]!;
}

/** One value per day from `from` to `to` for a currency, zero where nothing happened, so a chart has no gaps. */
export function fillDays(daily: DailyPoint[], currency: string, from: string, to: string): DailyPoint[] {
  const byDay = new Map(daily.filter((d) => d.currency === currency).map((d) => [d.day, d]));
  const out: DailyPoint[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, currency, revenueMinor: 0, paid: 0, attempts: 0 });
  }
  return out;
}
