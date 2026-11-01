/**
 * Sample data for the interactive product demo. Everything is derived from a seeded generator,
 * so the server and the browser render the same numbers (no hydration mismatch) and the
 * charts look the same on every visit.
 */

export type RangeKey = "24h" | "7d" | "30d";

export const RANGES: RangeKey[] = ["24h", "7d", "30d"];

export const RANGE_COMPARE: Record<RangeKey, string> = {
  "24h": "vs previous 24 hours",
  "7d": "vs previous 7 days",
  "30d": "vs previous 30 days",
};

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeriesPoint {
  label: string;
  visitors: number;
  sessions: number;
  pageviews: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_DAYS = Array.from({ length: 30 }, (_, i) => `Oct ${i + 1}`);

function build(range: RangeKey): SeriesPoint[] {
  const rand = seeded(range === "24h" ? 11 : range === "7d" ? 23 : 37);
  const count = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  return Array.from({ length: count }, (_, i) => {
    let base: number;
    let label: string;
    if (range === "24h") {
      // A working-day curve: quiet at night, a long afternoon peak.
      const hour = i;
      base = 70 + 130 * Math.max(0, Math.sin(((hour - 5) / 17) * Math.PI)) + rand() * 22;
      label = `${String(hour).padStart(2, "0")}:00`;
    } else if (range === "7d") {
      const weekend = i >= 5 ? 0.62 : 1;
      base = (2100 + i * 160 + rand() * 380) * weekend;
      label = WEEKDAYS[i] as string;
    } else {
      const weekend = i % 7 >= 5 ? 0.64 : 1;
      base = (1700 + i * 34 + Math.sin(i / 3) * 160 + rand() * 300) * weekend;
      label = MONTH_DAYS[i] as string;
    }
    const visitors = Math.round(base);
    const sessions = Math.round(visitors * (1.24 + rand() * 0.1));
    const pageviews = Math.round(sessions * (2.8 + rand() * 0.5));
    return { label, visitors, sessions, pageviews };
  });
}

export const SERIES: Record<RangeKey, SeriesPoint[]> = {
  "24h": build("24h"),
  "7d": build("7d"),
  "30d": build("30d"),
};

/** The previous period, as a fixed ratio per metric, so a delta is stable between renders. */
const PREVIOUS_RATIO: Record<RangeKey, { visitors: number; sessions: number; pageviews: number; bounce: number; duration: number }> = {
  "24h": { visitors: 0.91, sessions: 0.93, pageviews: 0.89, bounce: 1.04, duration: 0.96 },
  "7d": { visitors: 0.89, sessions: 0.91, pageviews: 0.88, bounce: 1.07, duration: 0.94 },
  "30d": { visitors: 0.95, sessions: 0.96, pageviews: 0.93, bounce: 1.02, duration: 0.98 },
};

export interface Kpis {
  visitors: number;
  sessions: number;
  pageviews: number;
  bounce: number;
  duration: number;
  pagesPerSession: number;
  prev: { visitors: number; sessions: number; pageviews: number; bounce: number; duration: number; pagesPerSession: number };
}

export function kpis(range: RangeKey): Kpis {
  const series = SERIES[range];
  const sum = (key: keyof SeriesPoint) => series.reduce((total, point) => total + (point[key] as number), 0);
  const visitors = sum("visitors");
  const sessions = sum("sessions");
  const pageviews = sum("pageviews");
  const bounce = range === "24h" ? 41.2 : range === "7d" ? 38.2 : 39.6;
  const duration = range === "24h" ? 148 : range === "7d" ? 172 : 164;
  const r = PREVIOUS_RATIO[range];
  const pagesPerSession = pageviews / sessions;
  return {
    visitors,
    sessions,
    pageviews,
    bounce,
    duration,
    pagesPerSession,
    prev: {
      visitors: Math.round(visitors * r.visitors),
      sessions: Math.round(sessions * r.sessions),
      pageviews: Math.round(pageviews * r.pageviews),
      bounce: bounce * r.bounce,
      duration: duration * r.duration,
      pagesPerSession: (pageviews * r.pageviews) / (sessions * r.sessions),
    },
  };
}

export function change(current: number, previous: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

export const fmtNumber = (value: number) => new Intl.NumberFormat("en-US").format(Math.round(value));
export const fmtPercent = (value: number) => `${value.toFixed(1)}%`;
export const fmtChange = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
export const fmtDuration = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;

/* ---------- Breakdowns ---------- */

export interface Share {
  name: string;
  share: number;
}

export const TOP_PAGES: Share[] = [
  { name: "/", share: 0.31 },
  { name: "/pricing", share: 0.18 },
  { name: "/docs/quickstart", share: 0.14 },
  { name: "/blog/cookieless-analytics", share: 0.09 },
  { name: "/signup", share: 0.08 },
  { name: "/changelog", share: 0.05 },
];

export const SOURCES: Share[] = [
  { name: "Google", share: 0.34 },
  { name: "Direct", share: 0.27 },
  { name: "GitHub", share: 0.14 },
  { name: "Hacker News", share: 0.09 },
  { name: "X", share: 0.06 },
  { name: "Newsletter", share: 0.04 },
];

export const CHANNELS: Share[] = [
  { name: "Organic search", share: 0.37 },
  { name: "Direct", share: 0.27 },
  { name: "Referral", share: 0.19 },
  { name: "Social", share: 0.1 },
  { name: "Email", share: 0.07 },
];

export const COUNTRIES: Share[] = [
  { name: "United States", share: 0.29 },
  { name: "Germany", share: 0.12 },
  { name: "United Kingdom", share: 0.1 },
  { name: "India", share: 0.09 },
  { name: "France", share: 0.07 },
  { name: "Canada", share: 0.06 },
  { name: "Netherlands", share: 0.05 },
  { name: "Brazil", share: 0.04 },
];

export const DEVICES: Record<string, Share[]> = {
  Device: [
    { name: "Desktop", share: 0.58 },
    { name: "Mobile", share: 0.37 },
    { name: "Tablet", share: 0.05 },
  ],
  Browser: [
    { name: "Chrome", share: 0.54 },
    { name: "Safari", share: 0.23 },
    { name: "Firefox", share: 0.12 },
    { name: "Edge", share: 0.08 },
  ],
  OS: [
    { name: "Windows", share: 0.34 },
    { name: "macOS", share: 0.29 },
    { name: "iOS", share: 0.18 },
    { name: "Android", share: 0.14 },
    { name: "Linux", share: 0.05 },
  ],
};

/* ---------- Funnels ---------- */

export interface FunnelTemplate {
  id: string;
  name: string;
  steps: { name: string; target: string; count: number }[];
}

const FUNNEL_SCALE: Record<RangeKey, number> = { "24h": 0.06, "7d": 0.42, "30d": 1 };

export const FUNNELS: FunnelTemplate[] = [
  {
    id: "signup",
    name: "Sign-up",
    steps: [
      { name: "Visit landing page", target: "/", count: 12480 },
      { name: "View pricing", target: "/pricing", count: 4912 },
      { name: "Start sign-up", target: "/signup", count: 1206 },
      { name: "Workspace created", target: "account_created", count: 874 },
    ],
  },
  {
    id: "install",
    name: "Install",
    steps: [
      { name: "Open quickstart", target: "/docs/quickstart", count: 5320 },
      { name: "Copy script tag", target: "copy_snippet", count: 2644 },
      { name: "First event received", target: "first_event", count: 1573 },
      { name: "Goal defined", target: "goal_created", count: 611 },
    ],
  },
];

export function funnelCounts(template: FunnelTemplate, range: RangeKey) {
  return template.steps.map((step) => ({ ...step, count: Math.round(step.count * FUNNEL_SCALE[range]) }));
}

/* ---------- Journeys ---------- */

export const JOURNEYS: { path: string[]; sessions: number }[] = [
  { path: ["/", "/pricing", "/signup"], sessions: 1840 },
  { path: ["/blog/cookieless-analytics", "/docs/quickstart", "/signup"], sessions: 1260 },
  { path: ["/", "/docs/quickstart", "/docs/frameworks"], sessions: 980 },
  { path: ["/pricing", "/signup"], sessions: 720 },
  { path: ["/", "/changelog"], sessions: 410 },
  { path: ["/docs/quickstart", "(left the site)"], sessions: 360 },
];

/* ---------- Web Vitals ---------- */

export interface Vital {
  key: string;
  name: string;
  unit: "ms" | "s" | "";
  value: number;
  good: number;
  poor: number;
  /** The share of visits rated good. */
  goodShare: number;
}

export const VITALS: Record<"Desktop" | "Mobile", Vital[]> = {
  Desktop: [
    { key: "LCP", name: "Largest Contentful Paint", unit: "s", value: 1.6, good: 2.5, poor: 4, goodShare: 0.94 },
    { key: "INP", name: "Interaction to Next Paint", unit: "ms", value: 82, good: 200, poor: 500, goodShare: 0.97 },
    { key: "CLS", name: "Cumulative Layout Shift", unit: "", value: 0.03, good: 0.1, poor: 0.25, goodShare: 0.96 },
    { key: "TTFB", name: "Time to First Byte", unit: "ms", value: 318, good: 800, poor: 1800, goodShare: 0.95 },
  ],
  Mobile: [
    { key: "LCP", name: "Largest Contentful Paint", unit: "s", value: 2.3, good: 2.5, poor: 4, goodShare: 0.81 },
    { key: "INP", name: "Interaction to Next Paint", unit: "ms", value: 164, good: 200, poor: 500, goodShare: 0.86 },
    { key: "CLS", name: "Cumulative Layout Shift", unit: "", value: 0.08, good: 0.1, poor: 0.25, goodShare: 0.88 },
    { key: "TTFB", name: "Time to First Byte", unit: "ms", value: 540, good: 800, poor: 1800, goodShare: 0.84 },
  ],
};

export function vitalRating(vital: Vital): "Good" | "Needs work" | "Poor" {
  return vital.value <= vital.good ? "Good" : vital.value <= vital.poor ? "Needs work" : "Poor";
}

/* ---------- People ---------- */

export interface Person {
  id: string;
  name: string;
  email: string;
  country: string;
  device: string;
  sessions: number;
  lastSeen: string;
  plan: string;
  timeline: { at: string; event: string; detail: string }[];
}

export const PEOPLE: Person[] = [
  {
    id: "u_4821",
    name: "Maya Brandt",
    email: "maya@northwind.io",
    country: "Germany",
    device: "Desktop · Chrome",
    sessions: 14,
    lastSeen: "2 min ago",
    plan: "Team",
    timeline: [
      { at: "10:42", event: "pageview", detail: "/pricing" },
      { at: "10:43", event: "custom", detail: "plan_toggled · annual" },
      { at: "10:44", event: "pageview", detail: "/signup" },
      { at: "10:46", event: "goal", detail: "account_created" },
    ],
  },
  {
    id: "u_3057",
    name: "Daniel Okafor",
    email: "daniel@fieldnote.app",
    country: "United Kingdom",
    device: "Mobile · Safari",
    sessions: 6,
    lastSeen: "18 min ago",
    plan: "Free",
    timeline: [
      { at: "09:58", event: "pageview", detail: "/blog/cookieless-analytics" },
      { at: "10:01", event: "custom", detail: "scroll_depth · 75" },
      { at: "10:03", event: "pageview", detail: "/docs/quickstart" },
    ],
  },
  {
    id: "u_7710",
    name: "Priya Nair",
    email: "priya@loomlabs.dev",
    country: "India",
    device: "Desktop · Firefox",
    sessions: 31,
    lastSeen: "1 h ago",
    plan: "Team",
    timeline: [
      { at: "09:12", event: "pageview", detail: "/docs/frameworks" },
      { at: "09:15", event: "custom", detail: "copy_snippet" },
      { at: "09:31", event: "custom", detail: "first_event" },
      { at: "09:40", event: "pageview", detail: "/overview" },
    ],
  },
  {
    id: "u_2294",
    name: "Lucas Ferreira",
    email: "lucas@tidebox.co",
    country: "Brazil",
    device: "Desktop · Edge",
    sessions: 3,
    lastSeen: "3 h ago",
    plan: "Free",
    timeline: [
      { at: "07:20", event: "pageview", detail: "/" },
      { at: "07:21", event: "pageview", detail: "/pricing" },
    ],
  },
];

/* ---------- Goals and events ---------- */

export const EVENTS: { name: string; kind: "Goal" | "Custom" | "Auto"; count: number; change: number }[] = [
  { name: "account_created", kind: "Goal", count: 874, change: 11.2 },
  { name: "copy_snippet", kind: "Custom", count: 2644, change: 18.4 },
  { name: "outbound_click", kind: "Auto", count: 1932, change: 4.1 },
  { name: "file_download", kind: "Auto", count: 618, change: -3.6 },
  { name: "scroll_depth", kind: "Auto", count: 9410, change: 6.9 },
  { name: "plan_toggled", kind: "Custom", count: 1208, change: 9.3 },
];

/* ---------- Realtime ---------- */

export const LIVE_EVENTS: { type: "pageview" | "custom" | "goal"; detail: string; country: string }[] = [
  { type: "pageview", detail: "/pricing", country: "DE" },
  { type: "pageview", detail: "/docs/quickstart", country: "US" },
  { type: "custom", detail: "copy_snippet", country: "IN" },
  { type: "pageview", detail: "/blog/cookieless-analytics", country: "GB" },
  { type: "goal", detail: "account_created", country: "FR" },
  { type: "pageview", detail: "/", country: "CA" },
  { type: "custom", detail: "plan_toggled", country: "NL" },
  { type: "pageview", detail: "/changelog", country: "BR" },
  { type: "pageview", detail: "/signup", country: "US" },
  { type: "custom", detail: "scroll_depth · 50", country: "DE" },
];
