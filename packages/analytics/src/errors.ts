export class AnalyticsQueryError extends Error {
  readonly code = "ANALYTICS_UNAVAILABLE";

  constructor(message = "Analytics query failed", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnalyticsQueryError";
  }
}

export class AnalyticsRangeTooWideError extends Error {
  readonly code = "RANGE_TOO_WIDE";
  readonly maxDays: number;

  constructor(maxDays: number) {
    super(`This query scans raw events and cannot cover more than ${maxDays} days.`);
    this.name = "AnalyticsRangeTooWideError";
    this.maxDays = maxDays;
  }
}
