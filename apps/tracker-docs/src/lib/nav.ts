import { FRAMEWORKS } from "@/lib/frameworks";

/**
 * The single list of documentation pages. The sidebar, search, prev/next links and
 * breadcrumbs are all built from it, so adding a page here is all it takes.
 */
export interface NavItem {
  title: string;
  href: string;
  description: string;
  keywords?: string[];
  icon?: string;
  badge?: "new";
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const frameworkItems: NavItem[] = FRAMEWORKS.filter((f) => f.group === "Frameworks").map((f) => ({
  title: f.name,
  href: `/docs/frameworks/${f.slug}`,
  description: f.tagline,
  keywords: f.keywords,
  icon: "code",
}));

const platformItems: NavItem[] = FRAMEWORKS.filter((f) => f.group === "Platforms & CMS").map((f) => ({
  title: f.name,
  href: `/docs/frameworks/${f.slug}`,
  description: f.tagline,
  keywords: f.keywords,
  icon: "globe",
}));

export const NAV: NavGroup[] = [
  {
    title: "Start here",
    items: [
      {
        title: "Introduction",
        href: "/docs",
        description: "What TrackMe is, how events flow, and what is supported.",
        keywords: ["overview", "about", "what is", "cookieless", "supported"],
        icon: "book",
      },
      {
        title: "Quickstart",
        href: "/docs/quickstart",
        description: "Install the tracker and see your first pageview in about five minutes.",
        keywords: ["install", "setup", "get started", "snippet", "site key", "first event"],
        icon: "rocket",
      },
      {
        title: "Verify your installation",
        href: "/docs/verify",
        description: "Confirm events are arriving, from the browser and from the dashboard.",
        keywords: ["check", "test", "debug", "network", "realtime", "first event", "console"],
        icon: "check",
      },
    ],
  },
  {
    title: "Frameworks",
    items: [
      {
        title: "All frameworks",
        href: "/docs/frameworks",
        description: "Setup guides for every supported framework, language and platform.",
        keywords: ["frameworks", "languages", "platforms", "react", "vue", "next", "angular", "svelte"],
        icon: "layers",
      },
      ...frameworkItems,
      {
        title: "Server-rendered apps",
        href: "/docs/frameworks/server-rendered",
        description: "Laravel, Rails, Django, Spring, ASP.NET, Express, Phoenix and Go templates.",
        keywords: [
          "php", "laravel", "blade", "ruby", "rails", "erb", "python", "django", "flask", "jinja",
          "java", "spring", "thymeleaf", "c#", "dotnet", "asp.net", "razor", "express", "ejs",
          "go", "templ", "phoenix", "elixir", "template",
        ],
        icon: "server",
      },
    ],
  },
  {
    title: "Platforms & CMS",
    items: platformItems,
  },
  {
    title: "Server-side",
    items: [
      {
        title: "HTTP API from any language",
        href: "/docs/server-side",
        description: "Send events from your backend in cURL, Node.js, Python, Go, PHP, Ruby, Java and C#.",
        keywords: [
          "backend", "server", "http", "api", "curl", "node", "python", "go", "golang", "php", "ruby",
          "java", "c#", "dotnet", "mobile", "ios", "android", "webhook", "stripe",
        ],
        icon: "terminal",
        badge: "new",
      },
    ],
  },
  {
    title: "Tracking",
    items: [
      {
        title: "Pageviews & routing",
        href: "/docs/tracking/pageviews",
        description: "How pageviews and single-page navigation are recorded.",
        keywords: ["spa", "router", "history api", "pushState", "bfcache", "prerender", "trackPageview"],
        icon: "route",
      },
      {
        title: "Custom events",
        href: "/docs/tracking/events",
        description: "Record clicks, signups and purchases with properties.",
        keywords: ["trackEvent", "properties", "naming", "limits", "conversion"],
        icon: "zap",
      },
      {
        title: "Identify users",
        href: "/docs/tracking/identify",
        description: "Tie activity to your own user ids and traits, and reset on sign-out.",
        keywords: ["identify", "reset", "user id", "traits", "people", "profiles", "distinctId"],
        icon: "user",
      },
      {
        title: "Campaigns & UTM",
        href: "/docs/tracking/campaigns",
        description: "Attribute traffic with UTM parameters.",
        keywords: ["utm", "campaign", "source", "medium", "acquisition", "referrer"],
        icon: "megaphone",
      },
      {
        title: "Web Vitals",
        href: "/docs/tracking/web-vitals",
        description: "LCP, INP, CLS, FCP and TTFB from real visitors.",
        keywords: ["core web vitals", "performance", "lcp", "inp", "cls", "fcp", "ttfb", "fid"],
        icon: "gauge",
      },
      {
        title: "Goals & funnels",
        href: "/docs/tracking/goals-funnels",
        description: "Turn events and pageviews into conversion goals and multi-step funnels.",
        keywords: ["goal", "funnel", "conversion", "trackGoal", "trackFunnelStep", "steps"],
        icon: "filter",
      },
    ],
  },
  {
    title: "Privacy & security",
    items: [
      {
        title: "Consent & Do Not Track",
        href: "/docs/privacy/consent",
        description: "Hold tracking until consent, and honour browser privacy signals.",
        keywords: ["gdpr", "ccpa", "consent", "banner", "dnt", "do not track", "cmp", "opt in", "opt out"],
        icon: "shield",
      },
      {
        title: "Data we collect",
        href: "/docs/privacy/data-collected",
        description: "Every field the tracker and the server record, and what is never stored.",
        keywords: ["privacy", "ip address", "cookies", "storage", "localStorage", "pseudonym", "retention"],
        icon: "eye",
      },
      {
        title: "Origin checks & CSP",
        href: "/docs/security/origin-csp",
        description: "Domain allow-listing, CORS, and the Content-Security-Policy you need.",
        keywords: ["csp", "content security policy", "cors", "origin", "referer", "domain", "allowlist"],
        icon: "lock",
      },
      {
        title: "First-party proxy & signing",
        href: "/docs/security/signing-proxy",
        description: "Serve the collector from your own domain and sign requests with an HMAC secret.",
        keywords: ["proxy", "hmac", "signature", "first party", "ad blocker", "nginx", "secret", "signingRequired"],
        icon: "key",
      },
    ],
  },
  {
    title: "Reference",
    items: [
      {
        title: "Tracker API",
        href: "/docs/reference/tracker-api",
        description: "Every method and constructor option of the JavaScript tracker.",
        keywords: ["GrowthTracker", "methods", "api", "window.growth", "init", "options", "adapters"],
        icon: "braces",
      },
      {
        title: "Script tag attributes",
        href: "/docs/reference/script-attributes",
        description: "The data-* attributes the tracker script reads.",
        keywords: ["data-site", "data-endpoint", "data-respect-dnt", "data-require-consent", "attributes"],
        icon: "tag",
      },
      {
        title: "Event schema",
        href: "/docs/reference/event-schema",
        description: "The exact shape and limits of an event.",
        keywords: ["schema", "fields", "json", "payload", "eventId", "occurredAt", "validation"],
        icon: "file",
      },
      {
        title: "Ingest API",
        href: "/docs/reference/ingest-api",
        description: "POST /v1/batch and /v1/e: headers, responses and status codes.",
        keywords: ["v1/batch", "v1/e", "collect", "endpoint", "headers", "status codes", "cors"],
        icon: "download",
      },
      {
        title: "REST API",
        href: "/docs/reference/rest-api",
        description: "Query metrics and manage sites, goals, funnels and keys with an API key.",
        keywords: ["api key", "bearer", "metrics", "overview", "breakdown", "scopes", "rest", "analytics api"],
        icon: "network",
      },
      {
        title: "Limits & quotas",
        href: "/docs/reference/limits",
        description: "Payload sizes, rate limits, monthly quotas and retention.",
        keywords: ["rate limit", "quota", "429", "402", "size", "retention", "batch"],
        icon: "sliders",
      },
      {
        title: "Errors",
        href: "/docs/reference/errors",
        description: "What each response means and how to fix it.",
        keywords: ["error", "400", "401", "402", "403", "413", "429", "500", "problem details"],
        icon: "alert",
      },
    ],
  },
  {
    title: "Operate",
    items: [
      {
        title: "Self-hosting",
        href: "/docs/operate/self-hosting",
        description: "Run the whole platform and configure it with environment variables.",
        keywords: ["docker", "deploy", "env", "environment", "kafka", "clickhouse", "postgres", "redis", "install"],
        icon: "server",
      },
      {
        title: "Architecture",
        href: "/docs/operate/architecture",
        description: "How an event travels from the browser to the dashboard.",
        keywords: ["architecture", "pipeline", "kafka", "worker", "ingestion", "flow", "diagram", "at least once"],
        icon: "workflow",
      },
      {
        title: "Troubleshooting",
        href: "/docs/operate/troubleshooting",
        description: "Symptoms, causes and fixes for missing or wrong data.",
        keywords: ["not working", "no data", "missing", "blocked", "ad blocker", "fix", "debug", "double count"],
        icon: "wrench",
      },
      {
        title: "FAQ",
        href: "/docs/operate/faq",
        description: "Short answers to common questions.",
        keywords: ["faq", "questions", "bots", "cookies", "accuracy", "unique visitors"],
        icon: "help",
      },
    ],
  },
];

export const ALL_PAGES: NavItem[] = NAV.flatMap((group) =>
  group.items.map((item) => ({ ...item }))
);

export function groupOf(href: string): string | undefined {
  return NAV.find((group) => group.items.some((item) => item.href === href))?.title;
}

export function pageOf(href: string): NavItem | undefined {
  return ALL_PAGES.find((page) => page.href === href);
}

/** Neighbours in reading order, for the previous / next links. */
export function neighbours(href: string): { prev?: NavItem; next?: NavItem } {
  const index = ALL_PAGES.findIndex((page) => page.href === href);
  if (index === -1) return {};
  const prev = ALL_PAGES[index - 1];
  const next = ALL_PAGES[index + 1];
  return { ...(prev ? { prev } : {}), ...(next ? { next } : {}) };
}
