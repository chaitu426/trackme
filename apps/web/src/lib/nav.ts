import {
  BarChart2,
  FileText,
  Filter,
  Gauge,
  MapPinned,
  Radio,
  Settings2,
  Target,
  TrendingUp,
  UserCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

/** Suite features that ship behind a flag. An item naming one is hidden until FEATURE_FLAGS lists it. */
export type FeatureFlag = "errors" | "retention" | "segments";

export interface NavItem {
  /** Path under the active site (`/<workspace>/sites/<domain>/<path>`), or under the workspace when `workspace` is set. */
  path: string;
  workspace?: true;
  label: string;
  icon: LucideIcon;
  badge?: "live" | "new";
  flag?: FeatureFlag;
}

export interface NavSuite {
  id: string;
  title: string;
  items: NavItem[];
}

/**
 * The site-scoped suites. Pages that already exist live here; each new feature is added to its
 * suite in the commit that ships its page, with a `flag` until it is approved. A suite with no
 * visible item is hidden, so there are never empty groups or dead links.
 */
export const NAV_SUITES: NavSuite[] = [
  {
    id: "analytics",
    title: "Analytics",
    items: [
      { path: "overview", workspace: true, label: "Overview", icon: BarChart2 },
      { path: "realtime", label: "Realtime", icon: Radio, badge: "live" },
      { path: "people", label: "User Profiles", icon: UserCheck, badge: "new" },
      { path: "journeys", label: "User Journeys", icon: Waypoints, badge: "new" },
      { path: "funnels", label: "Funnels", icon: Filter, badge: "new" },
      { path: "acquisition", label: "Acquisition", icon: TrendingUp },
      { path: "geography", label: "Audience Geography", icon: MapPinned },
      { path: "events", label: "Goals & Events", icon: Target },
    ],
  },
  {
    id: "performance",
    title: "Performance",
    items: [
      { path: "pages", label: "Page Performance", icon: FileText },
      { path: "vitals", label: "Web Vitals", icon: Gauge },
    ],
  },
];

export const SITE_SETTINGS_ITEM = { path: "settings", label: "Site Settings", icon: Settings2 } as const;

/** Flags listed in FEATURE_FLAGS ("errors, retention"), trimmed and lower-cased. */
export function parseFeatureFlags(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((flag) => flag.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Suites reduced to the items whose flag is on; suites left empty are dropped. */
export function visibleSuites(suites: NavSuite[], enabled: ReadonlySet<string>): NavSuite[] {
  return suites
    .map((suite) => ({ ...suite, items: suite.items.filter((item) => !item.flag || enabled.has(item.flag)) }))
    .filter((suite) => suite.items.length > 0);
}
