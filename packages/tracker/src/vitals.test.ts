import assert from "node:assert/strict";
import test from "node:test";

import { observeWebVitals } from "./vitals";

type ObserverCallback = (entries: Array<Record<string, unknown>>) => void;

test("emits one final metric per page view instead of on every callback", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalPerformance = globalThis.performance;
  const originalPerformanceObserver = globalThis.PerformanceObserver;

  const observers = new Map<string, ObserverCallback[]>();
  const windowListeners = new Map<string, Array<() => void>>();
  const documentListeners = new Map<string, Array<() => void>>();

  const registerListener = (map: Map<string, Array<() => void>>, type: string, callback: () => void) => {
    const current = map.get(type) ?? [];
    current.push(callback);
    map.set(type, current);
  };

  Object.defineProperty(globalThis, "window", {
    value: {
      addEventListener(type: string, callback: () => void) {
        registerListener(windowListeners, type, callback);
      },
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "document", {
    value: {
      visibilityState: "visible",
      addEventListener(type: string, callback: () => void) {
        registerListener(documentListeners, type, callback);
      },
    },
    configurable: true,
    writable: true,
  });

  Object.defineProperty(globalThis, "performance", {
    value: {
      getEntriesByType: (type: string) => {
        if (type === "navigation") {
          return [{ type: "navigate", responseStart: 150 }];
        }
        return [];
      },
    },
    configurable: true,
    writable: true,
  });

  class FakePerformanceObserver {
    public callback: ObserverCallback;

    constructor(callback: ObserverCallback) {
      this.callback = callback;
    }

    observe(options: { type: string }) {
      const callbacks = observers.get(options.type) ?? [];
      callbacks.push(this.callback);
      observers.set(options.type, callbacks);
    }
  }

  Object.defineProperty(globalThis, "PerformanceObserver", {
    value: FakePerformanceObserver,
    configurable: true,
    writable: true,
  });

  try {
    const metrics: Array<{ name: string; value: number }> = [];
    observeWebVitals((metric) => {
      metrics.push({ name: metric.name, value: metric.value });
    });

    observers.get("largest-contentful-paint")?.[0]?.({ getEntries: () => [{ startTime: 2500 }] });
    observers.get("layout-shift")?.[0]?.({
      getEntries: () => [{ value: 0.12, hadRecentInput: false }],
    });
    observers.get("paint")?.[0]?.({
      getEntries: () => [{ name: "first-contentful-paint", startTime: 1400 }],
    });
    observers.get("event")?.[0]?.({
      getEntries: () => [{ duration: 320 }],
    });
    observers.get("first-input")?.[0]?.({
      getEntries: () => [{ processingStart: 410, startTime: 220 }],
    });

    const hidden = documentListeners.get("visibilitychange")?.[0];
    assert.ok(hidden, "visibilitychange listener registered");
    Object.defineProperty(globalThis.document, "visibilityState", {
      value: "hidden",
      configurable: true,
      writable: true,
    });
    hidden();

    assert.equal(metrics.length, 6, "only one final metric per name is emitted");
    assert.deepEqual(
      metrics.map((m) => m.name).sort(),
      ["CLS", "FCP", "FID", "INP", "LCP", "TTFB"].sort(),
    );

    observers.get("largest-contentful-paint")?.[0]?.({
      getEntries: () => [{ startTime: 3100 }],
    });
    hidden();
    assert.equal(metrics.length, 6, "duplicate metrics are still coalesced to one value per metric");
  } finally {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true, writable: true });
    Object.defineProperty(globalThis, "performance", { value: originalPerformance, configurable: true, writable: true });
    Object.defineProperty(globalThis, "PerformanceObserver", {
      value: originalPerformanceObserver,
      configurable: true,
      writable: true,
    });
  }
});
