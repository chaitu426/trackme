export type RouteChangeCallback = (newPath: string, prevPath: string) => void;

/**
 * Instruments browser History API for zero-config SPA route transitions
 */
export function listenToRouteChanges(callback: RouteChangeCallback): () => void {
  if (typeof window === "undefined" || typeof history === "undefined") {
    return () => {};
  }

  let currentPath = window.location.pathname + window.location.search;

  const handleUrlChange = () => {
    const nextPath = window.location.pathname + window.location.search;
    if (nextPath !== currentPath) {
      const prev = currentPath;
      currentPath = nextPath;
      callback(nextPath, prev);
    }
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleUrlChange();
  };

  window.addEventListener("popstate", handleUrlChange);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", handleUrlChange);
  };
}

