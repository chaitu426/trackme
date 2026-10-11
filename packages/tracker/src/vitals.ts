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

  const reported = new Set<WebVitalMetric["name"]>();
  const latestValues = new Map<WebVitalMetric["name"], number>();
  const navigationType =
    performance.getEntriesByType("navigation").length > 0
      ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type
      : undefined;

  const flushFinalMetrics = (): void => {
    for (const name of ["LCP", "CLS", "FCP", "INP", "FID", "TTFB"] as const) {
      const value = latestValues.get(name);
      if (typeof value === "number" && !reported.has(name)) {
        reported.add(name);
        emit(onMetric, name, value, navigationType);
      }
    }
  };

  const remember = (name: WebVitalMetric["name"], value: number): void => {
    latestValues.set(name, value);
  };

  try {
    // LCP: one final value per page view; avoid counting every intermediate value.
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1];
      if (lastEntry) {
        remember("LCP", Math.round(lastEntry.startTime));
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // CLS: accumulate the current total and emit once, on final page teardown.
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (!entry.hadRecentInput && typeof entry.value === "number") {
          clsValue += entry.value;
        }
      }
      remember("CLS", Math.round(clsValue * 1000) / 1000);
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // FCP: the first contentful paint is stable for a given page load.
    const paintObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          remember("FCP", Math.round(entry.startTime));
        }
      }
    });
    paintObserver.observe({ type: "paint", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // INP: use the worst interaction duration seen so far and report only once.
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
          remember("INP", Math.round(worstInp));
        }
      }
    });
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
          remember("FID", Math.round(fid.processingStart - fid.startTime));
        }
      }
    });
    fidObserver.observe({ type: "first-input", buffered: true });
  } catch {
    // unsupported
  }

  try {
    // TTFB from navigation timing. This is stable per page load and not noisy.
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const nav = navEntries[0];
    if (nav && typeof nav.responseStart === "number" && nav.responseStart >= 0) {
      remember("TTFB", Math.round(nav.responseStart));
    }
  } catch {
    // unsupported
  }

  const flushOnHidden = () => {
    flushFinalMetrics();
  };

  // Final flush on teardown/visibility changes: this is the production-safe,
  // quota-friendly pattern used by metrics systems to send one observation per
  // metric per page view without spamming every observer callback.
  window.addEventListener("pagehide", flushOnHidden, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushOnHidden();
    }
  }, { once: true });

  if (document.visibilityState === "hidden") {
    flushFinalMetrics();
  }
}
