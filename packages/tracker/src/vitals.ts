import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { WebVitalMetric } from "@trackme/contracts";

export type MetricCallback = (metric: WebVitalMetric) => void;

/**
 * Core Web Vitals through Google's web-vitals library, so the numbers follow the same rules
 * as Chrome's own reports: CLS is the worst 5-second window of layout shifts, INP is close to
 * the 98th-percentile interaction, LCP stops at the first input, and each metric is reported
 * once per page load, when the page is hidden.
 *
 * FID is retired by the library and by Google. It stays in the event schema so old data and
 * old trackers keep validating.
 */
export function toWebVitalMetric(
  metric: Pick<Metric, "name" | "value" | "rating" | "navigationType">
): WebVitalMetric {
  return {
    name: metric.name,
    // CLS is a small unitless number; the rest are milliseconds.
    value: metric.name === "CLS" ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value),
    rating: metric.rating,
    ...(metric.navigationType ? { navigationType: metric.navigationType } : {}),
  };
}

export function observeWebVitals(onMetric: MetricCallback): void {
  if (typeof window === "undefined") return;
  const report = (metric: Metric) => onMetric(toWebVitalMetric(metric));
  try {
    onLCP(report);
    onCLS(report);
    onINP(report);
    onFCP(report);
    onTTFB(report);
  } catch {
    // A browser without the needed performance APIs just reports nothing.
  }
}
