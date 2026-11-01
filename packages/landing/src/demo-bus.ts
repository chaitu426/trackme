/** How the page and the demo talk: a tag, a chip or a menu entry asks the demo to do something. */
export const DEMO_EVENT = "trackme:demo-action";

export type DemoViewId =
  | "overview"
  | "realtime"
  | "people"
  | "journeys"
  | "funnels"
  | "acquisition"
  | "geography"
  | "events"
  | "vitals"
  | "pages"
  | "org"
  | "sites"
  | "settings";

export interface DemoAction {
  view?: DemoViewId;
  range?: "24h" | "7d" | "30d";
  /** A country name from the demo data, or null to clear the filter. */
  country?: string | null;
  device?: string | null;
}

export const DEMO_ANCHOR = "demo";

export function runDemo(action: DemoAction) {
  window.dispatchEvent(new CustomEvent<DemoAction>(DEMO_EVENT, { detail: action }));
  const target = document.getElementById(DEMO_ANCHOR);
  if (target) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
}

export const openDemoView = (view: DemoViewId) => runDemo({ view });
