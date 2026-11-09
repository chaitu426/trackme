import type { RetentionGranularity } from "@trackme/analytics";

// Pure helpers for the Retention page (URL state and the cohort window). Safe to import from client components.

export interface RetentionView {
  granularity: RetentionGranularity;
  /** Start cohorts at this custom event instead of a user's first visit. */
  cohortEvent?: string;
  /** Count a user as retained when they do this event, instead of any activity. */
  returnEvent?: string;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseRetentionView(raw: Raw): RetentionView {
  const g = first(raw.g);
  const text = (key: string) => {
    const value = first(raw[key])?.trim();
    return value && value.length <= 64 ? value : undefined;
  };
  const cohortEvent = text("cohortEvent");
  const returnEvent = text("returnEvent");
  return {
    granularity: g === "day" || g === "month" ? g : "week",
    ...(cohortEvent ? { cohortEvent } : {}),
    ...(returnEvent ? { returnEvent } : {}),
  };
}

export type ViewChange = { [K in keyof RetentionView]?: RetentionView[K] | undefined };

export function retentionHref(base: string, view: RetentionView, change: ViewChange = {}): string {
  const next: ViewChange = { ...view, ...change };
  const params = new URLSearchParams();
  if (next.granularity && next.granularity !== "week") params.set("g", next.granularity);
  if (next.cohortEvent) params.set("cohortEvent", next.cohortEvent);
  if (next.returnEvent) params.set("returnEvent", next.returnEvent);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** How many cohorts and follow-up periods each granularity shows. */
export const WINDOW: Record<RetentionGranularity, number> = { day: 14, week: 8, month: 6 };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The cohorts to show: the last WINDOW periods ending today, starting on a period boundary (a Monday, or the first of a
 * month) so the oldest cohort is not cut short.
 */
export function cohortWindow(granularity: RetentionGranularity, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periods = WINDOW[granularity];
  if (granularity === "day") return { from: iso(new Date(today.getTime() - (periods - 1) * 86_400_000)), to: iso(today) };
  if (granularity === "week") {
    const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
    return { from: iso(new Date(monday.getTime() - (periods - 1) * 7 * 86_400_000)), to: iso(today) };
  }
  return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (periods - 1), 1))), to: iso(today) };
}

export const periodLabel = (granularity: RetentionGranularity, index: number): string =>
  `${granularity === "day" ? "Day" : granularity === "week" ? "Week" : "Month"} ${index}`;
