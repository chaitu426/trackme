export class AnalyticsQueryError extends Error {
  readonly code = "ANALYTICS_UNAVAILABLE";

  constructor(message = "Analytics query failed", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnalyticsQueryError";
  }
}

/**
 * A workspace already has its share of dashboard queries running (see tenant-gate.ts). It extends
 * AnalyticsQueryError so the many `catch` blocks that rethrow that class pass it through unchanged;
 * the web layer tells it apart and answers 429 instead of 502.
 */
export class AnalyticsOverloadedError extends AnalyticsQueryError {
  readonly busy = true;

  constructor() {
    super("Too many analytics queries are running for this workspace. Retry in a moment.");
    this.name = "AnalyticsOverloadedError";
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
