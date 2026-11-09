import {
  BarChart2,
  FileText,
  Filter,
  Gauge,
  MapPinned,
  Radio,
  Bug,
  Repeat2,
  Rocket,
  Settings2,
  Target,
  TrendingUp,
  UserCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  /** Path under the active site (`/<workspace>/sites/<domain>/<path>`), or under the workspace when `workspace` is set. */
  path: string;
  workspace?: true;
  label: string;
  icon: LucideIcon;
  badge?: "live" | "new";
}

export interface NavSuite {
  id: string;
  title: string;
  items: NavItem[];
}

/**
 * The site-scoped suites. Every page that exists is listed here, and a page is added to its suite in the
 * commit that ships it. Nothing is hidden behind a flag: if it is built, it is in the sidebar.
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
      { path: "retention", label: "Retention & Cohorts", icon: Repeat2 },
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
  {
    id: "reliability",
    title: "Errors & Reliability",
    items: [
      { path: "errors", label: "Error Tracking", icon: Bug },
      { path: "releases", label: "Release Impact", icon: Rocket },
    ],
  },
];

export const SITE_SETTINGS_ITEM = { path: "settings", label: "Site Settings", icon: Settings2 } as const;
