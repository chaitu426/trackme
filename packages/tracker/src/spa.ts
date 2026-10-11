export type RouteChangeCallback = (newPath: string, prevPath: string) => void;

/**
 * Instruments browser History API for zero-config SPA route transitions
 */
export function listenToRouteChanges(callback: RouteChangeCallback): () => void {
  if (typeof window === "undefined" || typeof history === "undefined") {
    return () => {};
  }

  let currentPath = window.location.pathname + window.location.search;
  let pending: { nextPath: string; previousPath: string } | null = null;
  let frame: number | null = null;
  let enabled = true;

  const deliverAfterRender = () => {
    if (frame !== null || !enabled) return;
    // Framework routers update history before React, Vue, Svelte, or Angular
    // has committed the new route. Waiting one frame captures the settled URL
    // and document title without asking the application to add route hooks.
    frame = window.requestAnimationFrame(() => {
      frame = null;
      const change = pending;
      pending = null;
      if (change && enabled) callback(change.nextPath, change.previousPath);
    });
  };

  const handleUrlChange = () => {
    if (!enabled) return;
    const nextPath = window.location.pathname + window.location.search;
    if (nextPath !== currentPath) {
      const prev = currentPath;
      currentPath = nextPath;
      // A router may call replaceState more than once during one transition.
      // Keep the first referrer and report only the completed destination.
      pending = pending
        ? { nextPath, previousPath: pending.previousPath }
        : { nextPath, previousPath: prev };
      deliverAfterRender();
    }
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const wrappedPushState = function (this: History, ...args: Parameters<typeof history.pushState>) {
    const result = originalPushState.apply(this, args);
    handleUrlChange();
    return result;
  };

  const wrappedReplaceState = function (this: History, ...args: Parameters<typeof history.replaceState>) {
    const result = originalReplaceState.apply(this, args);
    handleUrlChange();
    return result;
  };

  history.pushState = wrappedPushState;
  history.replaceState = wrappedReplaceState;

  window.addEventListener("popstate", handleUrlChange);

  return () => {
    enabled = false;
    if (history.pushState === wrappedPushState) {
      history.pushState = originalPushState;
    }
    if (history.replaceState === wrappedReplaceState) {
      history.replaceState = originalReplaceState;
    }
    window.removeEventListener("popstate", handleUrlChange);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}
