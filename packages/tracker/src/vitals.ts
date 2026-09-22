import { WebVitalMetric } from "@trackme/contracts";

export type MetricCallback = (metric: WebVitalMetric) => void;

function ratingFor(
  name: WebVitalMetric["name"],
  value: number
): WebVitalMetric["rating"] {
  switch (name) {
    case "LCP":
      return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
    case "CLS":
      return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
    case "INP":
    case "FID":
      return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
    case "FCP":
      return value <= 1800 ? "good" : value <= 3000 ? "needs-improvement" : "poor";
    case "TTFB":
      return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
    default:
      return "needs-improvement";
  }
}

function emit(
  onMetric: MetricCallback,
  name: WebVitalMetric["name"],
  value: number,
  navigationType?: string
): void {
  onMetric({
    name,
    value,
    rating: ratingFor(name, value),
    ...(navigationType ? { navigationType } : {}),
  });
}

/**
 * Observe Core Web Vitals: LCP, CLS, INP, FCP, TTFB.
 * Best-effort — browsers without a given PerformanceObserver type skip that metric.
 */
export function observeWebVitals(onMetric: MetricCallback): void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return;
  }

  try {
    // LCP
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        emit(onMetric, "LCP", Math.round(lastEntry.startTime));
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // CLS
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as PerformanceEntry[]) {
        const layout = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!layout.hadRecentInput && typeof layout.value === "number") {
          clsValue += layout.value;
        }
      }
      emit(onMetric, "CLS", Math.round(clsValue * 1000) / 1000);
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // FCP
    const paintObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          emit(onMetric, "FCP", Math.round(entry.startTime));
        }
      }
    });
    paintObserver.observe({ type: "paint", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // INP (Interaction to Next Paint) via Event Timing
    let worstInp = 0;
    const inpObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as PerformanceEntry[]) {
        const ev = entry as PerformanceEntry & {
          interactionId?: number;
          duration?: number;
          processingStart?: number;
          startTime?: number;
        };
        const duration =
          typeof ev.duration === "number"
            ? ev.duration
            : typeof ev.processingStart === "number" && typeof ev.startTime === "number"
              ? ev.processingStart - ev.startTime
              : 0;
        if (duration > worstInp) {
          worstInp = duration;
          emit(onMetric, "INP", Math.round(worstInp));
        }
      }
    });
    // durationThreshold keeps noise down on busy pages
    inpObserver.observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit & { durationThreshold?: number });
  } catch {
    // unsupported — FID fallback below
  }

  try {
    // FID fallback for older browsers
    const fidObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as PerformanceEntry[]) {
        const fid = entry as PerformanceEntry & { processingStart?: number; startTime?: number };
        if (typeof fid.processingStart === "number" && typeof fid.startTime === "number") {
          emit(onMetric, "FID", Math.round(fid.processingStart - fid.startTime));
        }
      }
    });
    fidObserver.observe({ type: "first-input", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // TTFB from Navigation Timing
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const nav = navEntries[0];
    if (nav && typeof nav.responseStart === "number" && nav.responseStart >= 0) {
      emit(onMetric, "TTFB", Math.round(nav.responseStart), nav.type);
    }
  } catch {
    // unsupported
  }
}
