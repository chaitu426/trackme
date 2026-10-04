import type { GrowthTracker, PageviewOptions } from "./index.js";

type NavigationOptions = Omit<PageviewOptions, "url">;

/**
 * Minimal router bridge shared by every adapter. It is safe to call from a
 * React effect, a Next route hook, SvelteKit `afterNavigate`, or router event:
 * the core SDK removes the duplicate History API observation automatically.
 */
export function trackRoute(
  tracker: GrowthTracker,
  pathOrUrl: string,
  options: NavigationOptions = {}
): boolean {
  return tracker.trackNavigation(pathOrUrl, options);
}

/** React Router, TanStack Router, Remix client routes, or a custom React hook. */
export function trackReactRoute(
  tracker: GrowthTracker,
  pathname: string,
  search = ""
): boolean {
  return trackRoute(tracker, `${pathname}${search}`);
}

/** Next.js App Router: pass `usePathname()` and `useSearchParams().toString()`. */
export function trackNextAppRoute(
  tracker: GrowthTracker,
  pathname: string,
  searchParams?: string | URLSearchParams
): boolean {
  const search = typeof searchParams === "string" ? searchParams : searchParams?.toString() ?? "";
  return trackRoute(tracker, `${pathname}${search ? `?${search.replace(/^\?/, "")}` : ""}`);
}

/** Next.js Pages Router: pass `router.asPath` from `routeChangeComplete`. */
export function trackNextPagesRoute(tracker: GrowthTracker, asPath: string): boolean {
  return trackRoute(tracker, asPath);
}

/** Svelte/SvelteKit: pass `page.url` or the URL supplied by `afterNavigate`. */
export function trackSvelteRoute(tracker: GrowthTracker, url: URL | string): boolean {
  return trackRoute(tracker, typeof url === "string" ? url : url.href);
}

/** Vue Router: use in `router.afterEach((to) => trackVueRoute(tracker, to.fullPath))`. */
export function trackVueRoute(tracker: GrowthTracker, fullPath: string): boolean {
  return trackRoute(tracker, fullPath);
}

/** Angular Router: use for `NavigationEnd.urlAfterRedirects`. */
export function trackAngularRoute(tracker: GrowthTracker, urlAfterRedirects: string): boolean {
  return trackRoute(tracker, urlAfterRedirects);
}
