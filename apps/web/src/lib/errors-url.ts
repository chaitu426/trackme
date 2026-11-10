// Pure helpers for the Error Tracking pages (URL filters and date ranges). Safe to import from client components.
import type { ErrorSort } from "@trackme/analytics";
import type { StatusFilter } from "@trackme/contracts";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";

export interface ErrorFilters {
  range: RangeKey;
  status: StatusFilter;
  release?: string;
  environment?: string;
  level?: string;
  sort: ErrorSort;
  cursor?: string;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
const LEVELS = ["fatal", "error", "warning", "info"];

/** Reads the page's query string. Anything unrecognised falls back to the default instead of failing. */
export function parseErrorFilters(raw: Raw): ErrorFilters {
  const status = first(raw.status);
  const sort = first(raw.sort);
  const level = first(raw.level);
  const text = (key: string) => {
    const value = first(raw[key])?.trim();
    return value && value.length <= 64 ? value : undefined;
  };
  const release = text("release");
  const environment = text("environment");
  const cursor = first(raw.cursor);
  return {
    range: parseRangeKey(raw.range),
    status: status === "resolved" || status === "ignored" || status === "all" ? status : "open",
    ...(release ? { release } : {}),
    ...(environment ? { environment } : {}),
    ...(level && LEVELS.includes(level) ? { level } : {}),
    sort: sort === "events" || sort === "users" ? sort : "last_seen",
    ...(cursor && /^\d{1,20}:\d{1,20}$/.test(cursor) ? { cursor } : {}),
  };
}

/** The list URL for some filters, leaving out defaults so links stay short. Changing a filter drops the cursor. */
export type FilterChange = { [K in keyof ErrorFilters]?: ErrorFilters[K] | undefined };

export function errorsHref(base: string, filters: ErrorFilters, change: FilterChange = {}): string {
  const next: FilterChange = { ...filters, ...change };
  if (!("cursor" in change)) delete next.cursor;
  const params = new URLSearchParams();
  if (next.range && next.range !== "30d") params.set("range", next.range);
  if (next.status && next.status !== "open") params.set("status", next.status);
  if (next.release) params.set("release", next.release);
  if (next.environment) params.set("environment", next.environment);
  if (next.level) params.set("level", next.level);
  if (next.sort && next.sort !== "last_seen") params.set("sort", next.sort);
  if (next.cursor) params.set("cursor", next.cursor);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

const DAY_MS = 86_400_000;
const DAYS: Record<RangeKey, number> = { "24h": 1, "7d": 7, "30d": 30 };

/** Inclusive UTC dates covering a range: 24h is yesterday and today, 7d the last 7 days, and so on. */
export function rangeDates(range: RangeKey, now: Date = new Date()): { from: string; to: string; days: string[] } {
  // 24h means "since this time yesterday", which touches two UTC dates.
  const count = DAYS[range] + (range === "24h" ? 1 : 0);
  const days = Array.from({ length: count }, (_, i) =>
    new Date(now.getTime() - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );
  return { from: days[0]!, to: days[days.length - 1]!, days };
}

/** Events per day for one issue, zero-filled across the given days. */
export function fillDays(days: string[], points: Array<{ date: string; events: number }>): number[] {
  const byDay = new Map(points.map((p) => [p.date, p.events]));
  return days.map((day) => byDay.get(day) ?? 0);
}

/** The filters as "&a=b" pairs without the range, for the range pills, which add their own. */
export function filtersWithoutRange(filters: ErrorFilters): string {
  return errorsHref("", { ...filters, range: "30d" }, { cursor: undefined }).replace("?", "&");
}
