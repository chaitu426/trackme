import {
  Activity,
  RotateCcw,
  Stethoscope,
  Undo2,
  Plug,
  BarChart2,
  CreditCard,
  Droplets,
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
  Users,
  Globe,
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
  {
    id: "payments",
    title: "Payments & Revenue",
    items: [
      { path: "payments", label: "Payments Overview", icon: CreditCard },
      { path: "payments/checkout", label: "Checkout Funnel", icon: Filter },
      { path: "payments/health", label: "Gateway Health", icon: Activity },
      { path: "payments/failures", label: "Failure Doctor", icon: Stethoscope },
      { path: "payments/recovery", label: "Recovery", icon: RotateCcw },
      { path: "payments/leaks", label: "Revenue Leaks", icon: Droplets },
      { path: "payments/refunds", label: "Refunds & Disputes", icon: Undo2 },
      { path: "payments/connect", label: "Integrations", icon: Plug },
    ],
  },
];

export const SITE_SETTINGS_ITEM = { path: "settings", label: "Site Settings", icon: Settings2 } as const;

/** One place you can go: what the sidebar lists, what the command palette searches and what the breadcrumb is named after. */
export interface NavTarget {
  id: string;
  label: string;
  /** The suite it belongs to, shown as a heading in the palette. */
  group: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Every destination for the signed-in app, from NAV_SUITES plus the workspace pages. With no site yet, site pages point at the
 * page that adds one instead of a broken URL. This is the single source: the sidebar, the palette and the breadcrumb all read it.
 */
export function navTargets(workspaceSlug: string, siteDomain: string | null): NavTarget[] {
  const siteHref = (path: string) => (siteDomain ? `/${workspaceSlug}/sites/${siteDomain}/${path}` : `/${workspaceSlug}/settings/sites`);
  const out: NavTarget[] = [];
  for (const suite of NAV_SUITES) {
    for (const item of suite.items) {
      out.push({ id: `${suite.id}:${item.path}`, label: item.label, group: suite.title, href: item.workspace ? `/${workspaceSlug}/${item.path}` : siteHref(item.path), icon: item.icon });
    }
  }
  out.push(
    { id: "workspace:team", label: "Organization & Team", group: "Workspace", href: `/${workspaceSlug}/settings`, icon: Users },
    { id: "workspace:sites", label: "Websites", group: "Workspace", href: `/${workspaceSlug}/settings/sites`, icon: Globe },
    { id: "workspace:site-settings", label: SITE_SETTINGS_ITEM.label, group: "Workspace", href: siteHref(SITE_SETTINGS_ITEM.path), icon: SITE_SETTINGS_ITEM.icon }
  );
  return out;
}

/** The page name for the breadcrumb, from the path. A detail page (one error, one release) takes its list page's name. */
export function pageLabelFor(pathname: string, workspaceSlug: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== workspaceSlug) return undefined;
  if (parts[1] === "settings") return parts[2] === "sites" ? "Websites" : "Organization & Team";
  if (parts[1] === "overview") return "Overview";
  if (parts[1] !== "sites") return undefined;
  const rest = parts.slice(3).join("/");
  if (rest === "" ) return undefined;
  if (rest === SITE_SETTINGS_ITEM.path) return SITE_SETTINGS_ITEM.label;
  const items = NAV_SUITES.flatMap((s) => s.items).filter((i) => !i.workspace);
  // Longest matching path wins, so "payments/checkout" is not read as "payments".
  return items.filter((i) => rest === i.path || rest.startsWith(`${i.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]?.label;
}
