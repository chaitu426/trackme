import type { Snippet } from "@/components/code-block";

/**
 * Per-framework setup guides. Every guide has the same shape so the pages read the
 * same way: set up, track an event, identify a user, handle consent, then the
 * gotchas specific to that framework.
 *
 * Text fields accept a small inline subset: `code`, **bold** and [links](/path).
 */
export interface Step {
  title: string;
  body?: string;
  snippets?: Snippet[];
}

export interface Note {
  type: "note" | "tip" | "warning" | "danger";
  title?: string;
  text: string;
}

export interface Framework {
  slug: string;
  name: string;
  group: "Frameworks" | "Platforms & CMS";
  /** Short label used in cards and the nav. */
  tagline: string;
  language: string;
  /** How the first step is delivered. */
  method: string;
  /** Where you make the change. */
  files: string;
  /** What happens on navigation. */
  routing: string;
  keywords: string[];
  steps: Step[];
  /** Optional second path: import the tracker as a module. */
  moduleSteps?: Step[];
  events: Step;
  identify?: Step;
  consent?: Step;
  notes: Note[];
}

const SCRIPT_TAG = `<script
  defer
  src="https://app.example.com/tracker.js"
  data-site="YOUR_SITE_KEY"
  data-endpoint="https://ingest.example.com/v1/batch"
></script>`;

const TS_WINDOW = `// src/types/trackme.d.ts
type TrackProps = Record<string, string | number | boolean>;

interface Window {
  growth?: {
    trackEvent(name: string, properties?: TrackProps): void;
    trackGoal(goal: string, properties?: TrackProps): void;
    trackFunnelStep(funnel: string, step: string, properties?: TrackProps): void;
    identify(userId: string, traits?: TrackProps): void;
    reset(): void;
    grantConsent(): void;
    denyConsent(): void;
    getConsent(): "granted" | "denied" | null;
  };
}`;

const MODULE_NOTE: Note = {
  type: "note",
  title: "Where the package comes from",
  text: "`@trackme/tracker` lives in this repository (`packages/tracker`) and is not on the public npm registry. Publish it to your own registry, install it from your monorepo, or skip it: the script tag does everything the package does.",
};

const SPA_NOTE: Note = {
  type: "tip",
  title: "Do not add a second pageview",
  text: "The tracker already listens to the browser History API. Calling `trackPageview` from a router hook as well records every navigation twice. See [pageviews and routing](/docs/tracking/pageviews).",
};

export const FRAMEWORKS: Framework[] = [
  /* ----------------------------------------------------------------------- */
  {
    slug: "html",
    name: "HTML & static sites",
    group: "Frameworks",
    tagline: "Any website that can edit its HTML.",
    language: "HTML / JavaScript",
    method: "Script tag",
    files: "Your base HTML template or layout",
    routing:
      "Every full page load is a pageview. Single-page navigation (anything that calls `history.pushState`) is tracked automatically.",
    keywords: ["html", "static", "jekyll", "hugo", "eleventy", "11ty", "vanilla", "jamstack", "script tag"],
    steps: [
      {
        title: "Add the snippet to every page",
        body: "Paste it inside `<head>`. `defer` keeps it from blocking rendering. Use **Your setup** in the header to put your own values into every sample on this site.",
        snippets: [{ lang: "html", code: SCRIPT_TAG }],
      },
      {
        title: "Put it in your base template",
        body: "Add it once to the layout your pages share, so new pages are covered without extra work.",
        snippets: [
          {
            lang: "html",
            filename: "index.html",
            code: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My site</title>
    <script
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    ></script>
  </head>
  <body>
    <!-- your page -->
  </body>
</html>`,
          },
        ],
      },
      {
        title: "Load the page and check",
        body: "Open your site in a normal browser window, then open **Realtime** in the dashboard. Your visit should appear within a few seconds. [Verify your installation](/docs/verify) lists what to check if it does not.",
      },
    ],
    events: {
      title: "Track a button click",
      body: "The tracker is available as `window.growth` once the page has parsed. Wait for `DOMContentLoaded` if you call it from an inline script, because a deferred script runs after inline ones.",
      snippets: [
        {
          lang: "html",
          code: `<button id="signup">Start free trial</button>

<script>
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("signup").addEventListener("click", function () {
      window.growth && window.growth.trackEvent("signup_clicked", {
        plan: "pro",
        location: "hero",
      });
    });
  });
</script>`,
        },
      ],
    },
    identify: {
      title: "Identify a signed-in visitor",
      snippets: [
        {
          lang: "html",
          code: `<script>
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify("user_8421", { plan: "pro" });
  });
</script>`,
        },
      ],
    },
    consent: {
      title: "Wait for consent",
      body: "Add `data-require-consent=\"true\"`. The tracker stays idle until you call `grantConsent()`.",
      snippets: [
        {
          lang: "html",
          code: `<script
  defer
  src="https://app.example.com/tracker.js"
  data-site="YOUR_SITE_KEY"
  data-endpoint="https://ingest.example.com/v1/batch"
  data-require-consent="true"
></script>

<button onclick="window.growth && window.growth.grantConsent()">Accept analytics</button>
<button onclick="window.growth && window.growth.denyConsent()">Decline</button>`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      {
        type: "note",
        title: "Static site generators",
        text: "For Jekyll, Hugo, Eleventy and similar, put the snippet in the partial that renders `<head>` (`_includes/head.html`, `layouts/partials/head.html`, and so on).",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "react",
    name: "React",
    group: "Frameworks",
    tagline: "Vite, Create React App, Parcel and other client-side React apps.",
    language: "JavaScript / TypeScript",
    method: "Script tag, or module",
    files: "index.html, plus any component that tracks events",
    routing:
      "Automatic for React Router, TanStack Router and any router that uses the History API. No route hook needed.",
    keywords: ["react", "vite", "cra", "create react app", "react router", "tanstack", "jsx", "tsx", "hooks"],
    steps: [
      {
        title: "Add the script to index.html",
        body: "Put it in `<head>` of the HTML file that mounts your app (`index.html` in Vite, `public/index.html` in Create React App).",
        snippets: [
          {
            lang: "html",
            filename: "index.html",
            code: `<head>
  <meta charset="UTF-8" />
  <title>My app</title>
  <script
    defer
    src="https://app.example.com/tracker.js"
    data-site="YOUR_SITE_KEY"
    data-endpoint="https://ingest.example.com/v1/batch"
  ></script>
</head>`,
          },
        ],
      },
      {
        title: "Add types (TypeScript only)",
        body: "So `window.growth` is typed in your components.",
        snippets: [{ lang: "typescript", code: TS_WINDOW, filename: "src/types/trackme.d.ts" }],
      },
    ],
    moduleSteps: [
      {
        title: "Install and initialise once",
        body: "Create the tracker before the app renders. Do this in one place only.",
        snippets: [
          {
            lang: "typescript",
            filename: "src/analytics.ts",
            code: `import { GrowthTracker } from "@trackme/tracker";

export const tracker = new GrowthTracker({
  siteKey: import.meta.env.VITE_TRACKME_SITE_KEY,
  endpoint: import.meta.env.VITE_TRACKME_ENDPOINT,
});

tracker.init();`,
          },
          {
            lang: "tsx",
            filename: "src/main.tsx",
            code: `import "./analytics"; // runs init() before React mounts
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);`,
          },
        ],
      },
    ],
    events: {
      title: "Track events from components",
      body: "Optional chaining keeps the call safe if an ad blocker stopped the script from loading.",
      snippets: [
        {
          lang: "tsx",
          filename: "src/components/UpgradeButton.tsx",
          code: `export function UpgradeButton({ plan }: { plan: string }) {
  return (
    <button
      onClick={() => {
        window.growth?.trackEvent("upgrade_clicked", { plan });
        // ...start checkout
      }}
    >
      Upgrade to {plan}
    </button>
  );
}`,
        },
        {
          lang: "tsx",
          filename: "src/hooks/useTrack.ts",
          code: `import { useCallback } from "react";

type Props = Record<string, string | number | boolean>;

/** Stable function that is a no-op until the tracker has loaded. */
export function useTrack() {
  return useCallback((name: string, props?: Props) => {
    window.growth?.trackEvent(name, props);
  }, []);
}`,
        },
      ],
    },
    identify: {
      title: "Identify the user after sign-in",
      snippets: [
        {
          lang: "tsx",
          code: `import { useEffect } from "react";

export function useIdentify(user: { id: string; plan: string } | null) {
  useEffect(() => {
    if (user) window.growth?.identify(user.id, { plan: user.plan });
    else window.growth?.reset();
  }, [user]);
}`,
        },
      ],
    },
    consent: {
      title: "A consent banner",
      body: "Set `data-require-consent=\"true\"` on the script tag, then call `grantConsent()` when the visitor accepts.",
      snippets: [
        {
          lang: "tsx",
          code: `import { useState } from "react";

export function ConsentBanner() {
  const [answered, setAnswered] = useState(
    () => window.growth?.getConsent() != null
  );
  if (answered) return null;

  return (
    <div role="dialog" aria-label="Analytics consent">
      <p>We use cookieless analytics to improve the site.</p>
      <button onClick={() => { window.growth?.grantConsent(); setAnswered(true); }}>Accept</button>
      <button onClick={() => { window.growth?.denyConsent(); setAnswered(true); }}>Decline</button>
    </div>
  );
}`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      MODULE_NOTE,
      {
        type: "tip",
        title: "React StrictMode",
        text: "StrictMode runs effects twice in development. Initialising in a module (`analytics.ts`) or with the script tag avoids a double `init()`; calling `init()` inside `useEffect` does not, although a second `init()` call is ignored.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "nextjs-app",
    name: "Next.js (App Router)",
    group: "Frameworks",
    tagline: "app/ directory, Server and Client Components.",
    language: "TypeScript / JavaScript",
    method: "next/script, or module",
    files: "app/layout.tsx",
    routing:
      "Automatic. The App Router navigates with the History API, so client transitions are tracked without a route hook.",
    keywords: ["next", "nextjs", "next.js", "app router", "rsc", "server components", "vercel", "next/script"],
    steps: [
      {
        title: "Add the script to the root layout",
        body: "Use `next/script` so Next controls loading. `afterInteractive` loads it once the page is interactive. Extra `data-*` props are written to the script element as attributes.",
        snippets: [
          {
            lang: "tsx",
            filename: "app/layout.tsx",
            code: `import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src={process.env.NEXT_PUBLIC_TRACKME_SCRIPT_URL}
          data-site={process.env.NEXT_PUBLIC_TRACKME_SITE_KEY}
          data-endpoint={process.env.NEXT_PUBLIC_TRACKME_ENDPOINT}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`,
          },
        ],
      },
      {
        title: "Set the environment variables",
        body: "All three are public values, so the `NEXT_PUBLIC_` prefix is correct.",
        snippets: [
          {
            lang: "ini",
            filename: ".env.local",
            code: `NEXT_PUBLIC_TRACKME_SCRIPT_URL=https://app.example.com/tracker.js
NEXT_PUBLIC_TRACKME_SITE_KEY=YOUR_SITE_KEY
NEXT_PUBLIC_TRACKME_ENDPOINT=https://ingest.example.com/v1/batch`,
          },
        ],
      },
      {
        title: "Add types",
        snippets: [{ lang: "typescript", code: TS_WINDOW, filename: "types/trackme.d.ts" }],
      },
    ],
    moduleSteps: [
      {
        title: "A client component that initialises the tracker",
        body: "The constructor and `init()` do nothing on the server, so this is safe in a component that is also server-rendered.",
        snippets: [
          {
            lang: "tsx",
            filename: "components/tracker.tsx",
            code: `"use client";

import { useEffect } from "react";
import { GrowthTracker } from "@trackme/tracker";

let tracker: GrowthTracker | undefined;

export function Tracker() {
  useEffect(() => {
    tracker ??= new GrowthTracker({
      siteKey: process.env.NEXT_PUBLIC_TRACKME_SITE_KEY!,
      endpoint: process.env.NEXT_PUBLIC_TRACKME_ENDPOINT!,
    });
    tracker.init();
    window.growth = tracker;
  }, []);

  return null;
}`,
          },
          {
            lang: "tsx",
            filename: "app/layout.tsx",
            code: `import { Tracker } from "@/components/tracker";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Tracker />
        {children}
      </body>
    </html>
  );
}`,
          },
        ],
      },
    ],
    events: {
      title: "Track events from a Client Component",
      body: "Event handlers run in the browser, so they must live in a Client Component (`\"use client\"`). For events that happen on the server, such as a completed payment, use the [HTTP API](/docs/server-side).",
      snippets: [
        {
          lang: "tsx",
          filename: "components/buy-button.tsx",
          code: `"use client";

export function BuyButton({ sku }: { sku: string }) {
  return (
    <button
      onClick={() => window.growth?.trackEvent("add_to_cart", { sku })}
    >
      Add to cart
    </button>
  );
}`,
        },
      ],
    },
    identify: {
      title: "Identify after sign-in",
      snippets: [
        {
          lang: "tsx",
          filename: "components/identify.tsx",
          code: `"use client";

import { useEffect } from "react";

export function Identify({ userId, plan }: { userId: string; plan: string }) {
  useEffect(() => {
    window.growth?.identify(userId, { plan });
  }, [userId, plan]);
  return null;
}`,
        },
      ],
    },
    consent: {
      title: "Consent",
      body: "Add `data-require-consent=\"true\"` to the `<Script>`, then call `grantConsent()` from your cookie banner.",
      snippets: [
        {
          lang: "tsx",
          code: `<Script
  src={process.env.NEXT_PUBLIC_TRACKME_SCRIPT_URL}
  data-site={process.env.NEXT_PUBLIC_TRACKME_SITE_KEY}
  data-endpoint={process.env.NEXT_PUBLIC_TRACKME_ENDPOINT}
  data-require-consent="true"
  strategy="afterInteractive"
/>`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      MODULE_NOTE,
      {
        type: "warning",
        title: "Content-Security-Policy",
        text: "If you set a CSP, allow the tracker script origin in `script-src` and the ingest origin in `connect-src`. With nonces, pass `nonce={nonce}` to `<Script>`. See [origin checks and CSP](/docs/security/origin-csp).",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "nextjs-pages",
    name: "Next.js (Pages Router)",
    group: "Frameworks",
    tagline: "pages/ directory with _app and _document.",
    language: "TypeScript / JavaScript",
    method: "next/script, or module",
    files: "pages/_app.tsx",
    routing:
      "Automatic. The Pages Router navigates with the History API; you do not need to listen to `routeChangeComplete`.",
    keywords: ["next", "nextjs", "pages router", "_app", "_document", "next/script"],
    steps: [
      {
        title: "Add the script to _app",
        snippets: [
          {
            lang: "tsx",
            filename: "pages/_app.tsx",
            code: `import type { AppProps } from "next/app";
import Script from "next/script";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script
        src={process.env.NEXT_PUBLIC_TRACKME_SCRIPT_URL}
        data-site={process.env.NEXT_PUBLIC_TRACKME_SITE_KEY}
        data-endpoint={process.env.NEXT_PUBLIC_TRACKME_ENDPOINT}
        strategy="afterInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}`,
          },
        ],
      },
      {
        title: "Set the environment variables",
        snippets: [
          {
            lang: "ini",
            filename: ".env.local",
            code: `NEXT_PUBLIC_TRACKME_SCRIPT_URL=https://app.example.com/tracker.js
NEXT_PUBLIC_TRACKME_SITE_KEY=YOUR_SITE_KEY
NEXT_PUBLIC_TRACKME_ENDPOINT=https://ingest.example.com/v1/batch`,
          },
        ],
      },
    ],
    moduleSteps: [
      {
        title: "Initialise in _app",
        snippets: [
          {
            lang: "tsx",
            filename: "pages/_app.tsx",
            code: `import { useEffect } from "react";
import type { AppProps } from "next/app";
import { GrowthTracker } from "@trackme/tracker";

let tracker: GrowthTracker | undefined;

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    tracker ??= new GrowthTracker({
      siteKey: process.env.NEXT_PUBLIC_TRACKME_SITE_KEY!,
      endpoint: process.env.NEXT_PUBLIC_TRACKME_ENDPOINT!,
    });
    tracker.init();
    window.growth = tracker;
  }, []);

  return <Component {...pageProps} />;
}`,
          },
        ],
      },
    ],
    events: {
      title: "Track events",
      snippets: [
        {
          lang: "tsx",
          code: `export default function Pricing() {
  return (
    <button onClick={() => window.growth?.trackEvent("pricing_cta", { plan: "team" })}>
      Choose Team
    </button>
  );
}`,
        },
      ],
    },
    identify: {
      title: "Identify after sign-in",
      snippets: [
        {
          lang: "tsx",
          code: `import { useEffect } from "react";
import { useSession } from "next-auth/react";

export function IdentifyUser() {
  const { data } = useSession();
  useEffect(() => {
    if (data?.user?.email) window.growth?.identify(data.user.email);
  }, [data]);
  return null;
}`,
        },
      ],
    },
    notes: [SPA_NOTE, MODULE_NOTE],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "remix",
    name: "Remix & React Router",
    group: "Frameworks",
    tagline: "Remix and React Router framework mode.",
    language: "TypeScript / JavaScript",
    method: "Script tag in root",
    files: "app/root.tsx",
    routing: "Automatic. Client-side transitions use the History API.",
    keywords: ["remix", "react router", "react router 7", "rr7", "root.tsx"],
    steps: [
      {
        title: "Add the script to the root document",
        body: "Render it in the `<head>` of your root layout so it is part of the server-rendered HTML.",
        snippets: [
          {
            lang: "tsx",
            filename: "app/root.tsx",
            code: `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <Meta />
        <Links />
        <script
          defer
          src="https://app.example.com/tracker.js"
          data-site="YOUR_SITE_KEY"
          data-endpoint="https://ingest.example.com/v1/batch"
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}`,
          },
        ],
      },
    ],
    events: {
      title: "Track events",
      body: "Handlers run in the browser. For work done in an `action`, track it from the server with the [HTTP API](/docs/server-side).",
      snippets: [
        {
          lang: "tsx",
          code: `import { Form } from "react-router";

export function NewsletterForm() {
  return (
    <Form method="post" onSubmit={() => window.growth?.trackEvent("newsletter_signup")}>
      <input type="email" name="email" required />
      <button type="submit">Subscribe</button>
    </Form>
  );
}`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      {
        type: "note",
        text: "On Remix v2 import from `@remix-run/react` instead of `react-router`; the script tag is identical.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "vue",
    name: "Vue",
    group: "Frameworks",
    tagline: "Vue 3 with Vite and Vue Router.",
    language: "TypeScript / JavaScript",
    method: "Script tag, or plugin",
    files: "index.html, plus a composable",
    routing: "Automatic for Vue Router in history mode. Hash mode changes the URL fragment only; see the note below.",
    keywords: ["vue", "vue 3", "vue router", "vite", "composition api", "pinia", "script setup"],
    steps: [
      {
        title: "Add the script to index.html",
        snippets: [
          {
            lang: "html",
            filename: "index.html",
            code: `<head>
  <meta charset="UTF-8" />
  <title>My app</title>
  <script
    defer
    src="https://app.example.com/tracker.js"
    data-site="YOUR_SITE_KEY"
    data-endpoint="https://ingest.example.com/v1/batch"
  ></script>
</head>`,
          },
        ],
      },
      {
        title: "Add a composable",
        body: "A thin wrapper so components never touch `window` directly.",
        snippets: [
          {
            lang: "typescript",
            filename: "src/composables/useTrack.ts",
            code: `type Props = Record<string, string | number | boolean>;

export function useTrack() {
  return {
    event: (name: string, props?: Props) => window.growth?.trackEvent(name, props),
    goal: (name: string, props?: Props) => window.growth?.trackGoal(name, props),
    identify: (id: string, traits?: Props) => window.growth?.identify(id, traits),
  };
}`,
          },
          { lang: "typescript", code: TS_WINDOW, filename: "src/types/trackme.d.ts" },
        ],
      },
    ],
    moduleSteps: [
      {
        title: "Install as a Vue plugin",
        snippets: [
          {
            lang: "typescript",
            filename: "src/plugins/trackme.ts",
            code: `import type { App } from "vue";
import { GrowthTracker } from "@trackme/tracker";

export const trackme = {
  install(app: App) {
    const tracker = new GrowthTracker({
      siteKey: import.meta.env.VITE_TRACKME_SITE_KEY,
      endpoint: import.meta.env.VITE_TRACKME_ENDPOINT,
    });
    tracker.init();
    app.provide("tracker", tracker);
    app.config.globalProperties.$tracker = tracker;
  },
};`,
          },
          {
            lang: "typescript",
            filename: "src/main.ts",
            code: `import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { trackme } from "./plugins/trackme";

createApp(App).use(router).use(trackme).mount("#app");`,
          },
        ],
      },
    ],
    events: {
      title: "Track events in a component",
      snippets: [
        {
          lang: "vue",
          filename: "src/components/CheckoutButton.vue",
          code: `<script setup lang="ts">
import { useTrack } from "../composables/useTrack";

const track = useTrack();

function start() {
  track.event("checkout_started", { items: 3, currency: "USD" });
  // ...navigate to checkout
}
</script>

<template>
  <button @click="start">Checkout</button>
</template>`,
        },
      ],
    },
    identify: {
      title: "Identify when the user changes",
      snippets: [
        {
          lang: "typescript",
          code: `import { watch } from "vue";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();

watch(
  () => auth.user,
  (user) => {
    if (user) window.growth?.identify(user.id, { plan: user.plan });
    else window.growth?.reset();
  },
  { immediate: true }
);`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      MODULE_NOTE,
      {
        type: "warning",
        title: "Hash-mode routing",
        text: "Vue Router's hash mode (`createWebHashHistory`) puts the route after `#`. The tracker records the path and query, not the fragment, so every hash route is reported as the same page. Use history mode (`createWebHistory`) for per-page analytics.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "nuxt",
    name: "Nuxt",
    group: "Frameworks",
    tagline: "Nuxt 3 and later, server-rendered or static.",
    language: "TypeScript / JavaScript",
    method: "App head config, or plugin",
    files: "nuxt.config.ts",
    routing: "Automatic. Nuxt's router uses the History API.",
    keywords: ["nuxt", "nuxt 3", "nitro", "useHead", "runtimeConfig", "plugins"],
    steps: [
      {
        title: "Add the script in nuxt.config.ts",
        body: "Nuxt writes it into the server-rendered `<head>`. Extra keys on the script entry become HTML attributes.",
        snippets: [
          {
            lang: "typescript",
            filename: "nuxt.config.ts",
            code: `export default defineNuxtConfig({
  app: {
    head: {
      script: [
        {
          src: "https://app.example.com/tracker.js",
          defer: true,
          "data-site": "YOUR_SITE_KEY",
          "data-endpoint": "https://ingest.example.com/v1/batch",
        },
      ],
    },
  },
});`,
          },
        ],
      },
      {
        title: "Read values from runtime config (optional)",
        body: "To keep keys out of source, set them with `NUXT_PUBLIC_*` environment variables and build the tag in `app.vue`.",
        snippets: [
          {
            lang: "vue",
            filename: "app.vue",
            code: `<script setup lang="ts">
const config = useRuntimeConfig();

useHead({
  script: [
    {
      src: config.public.trackmeScriptUrl as string,
      defer: true,
      "data-site": config.public.trackmeSiteKey as string,
      "data-endpoint": config.public.trackmeEndpoint as string,
    },
  ],
});
</script>

<template>
  <NuxtPage />
</template>`,
          },
        ],
      },
    ],
    events: {
      title: "Track events",
      snippets: [
        {
          lang: "vue",
          code: `<script setup lang="ts">
function subscribe() {
  window.growth?.trackEvent("newsletter_signup", { source: "footer" });
}
</script>

<template>
  <button @click="subscribe">Subscribe</button>
</template>`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      {
        type: "note",
        text: "Client-only code such as `window.growth` belongs in event handlers or `onMounted`, not in top-level `<script setup>` code that also runs during server rendering.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "sveltekit",
    name: "SvelteKit",
    group: "Frameworks",
    tagline: "SvelteKit and plain Svelte with Vite.",
    language: "TypeScript / JavaScript",
    method: "Script tag in app.html",
    files: "src/app.html",
    routing: "Automatic. SvelteKit's client router uses the History API.",
    keywords: ["svelte", "sveltekit", "app.html", "svelte 5", "runes", "vite"],
    steps: [
      {
        title: "Add the script to src/app.html",
        snippets: [
          {
            lang: "html",
            filename: "src/app.html",
            code: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    ></script>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>`,
          },
        ],
      },
      {
        title: "Add types",
        snippets: [
          {
            lang: "typescript",
            filename: "src/app.d.ts",
            code: `type TrackProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    growth?: {
      trackEvent(name: string, properties?: TrackProps): void;
      identify(userId: string, traits?: TrackProps): void;
      reset(): void;
      grantConsent(): void;
      denyConsent(): void;
    };
  }
}

export {};`,
          },
        ],
      },
    ],
    moduleSteps: [
      {
        title: "Initialise in the client hook",
        snippets: [
          {
            lang: "typescript",
            filename: "src/hooks.client.ts",
            code: `import { GrowthTracker } from "@trackme/tracker";
import { PUBLIC_TRACKME_SITE_KEY, PUBLIC_TRACKME_ENDPOINT } from "$env/static/public";

const tracker = new GrowthTracker({
  siteKey: PUBLIC_TRACKME_SITE_KEY,
  endpoint: PUBLIC_TRACKME_ENDPOINT,
});
tracker.init();
window.growth = tracker as unknown as Window["growth"];`,
          },
        ],
      },
    ],
    events: {
      title: "Track events",
      snippets: [
        {
          lang: "svelte",
          filename: "src/routes/+page.svelte",
          code: `<script lang="ts">
  function onDownload() {
    window.growth?.trackEvent("download_clicked", { file: "guide.pdf" });
  }
</script>

<button onclick={onDownload}>Download the guide</button>`,
        },
      ],
    },
    identify: {
      title: "Identify from your layout",
      snippets: [
        {
          lang: "svelte",
          filename: "src/routes/+layout.svelte",
          code: `<script lang="ts">
  let { data, children } = $props();

  $effect(() => {
    if (data.user) window.growth?.identify(data.user.id, { plan: data.user.plan });
    else window.growth?.reset();
  });
</script>

{@render children()}`,
        },
      ],
    },
    notes: [SPA_NOTE, MODULE_NOTE],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "angular",
    name: "Angular",
    group: "Frameworks",
    tagline: "Angular CLI apps, with or without SSR.",
    language: "TypeScript",
    method: "Script tag, or service",
    files: "src/index.html, plus a service",
    routing: "Automatic for the Angular Router with the default path location strategy.",
    keywords: ["angular", "angular cli", "ng", "service", "injectable", "ssr", "universal", "router"],
    steps: [
      {
        title: "Add the script to src/index.html",
        snippets: [
          {
            lang: "html",
            filename: "src/index.html",
            code: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My app</title>
    <base href="/" />
    <script
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    ></script>
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>`,
          },
        ],
      },
      {
        title: "Wrap it in a service",
        body: "Keeps `window` access in one place and makes the call safe during server-side rendering.",
        snippets: [
          { lang: "typescript", code: TS_WINDOW, filename: "src/typings.d.ts" },
          {
            lang: "typescript",
            filename: "src/app/analytics.service.ts",
            code: `import { Injectable, PLATFORM_ID, inject } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";

type Props = Record<string, string | number | boolean>;

@Injectable({ providedIn: "root" })
export class AnalyticsService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  track(name: string, props?: Props): void {
    if (this.isBrowser) window.growth?.trackEvent(name, props);
  }

  identify(userId: string, traits?: Props): void {
    if (this.isBrowser) window.growth?.identify(userId, traits);
  }

  reset(): void {
    if (this.isBrowser) window.growth?.reset();
  }
}`,
          },
        ],
      },
    ],
    moduleSteps: [
      {
        title: "Initialise at application start",
        snippets: [
          {
            lang: "typescript",
            filename: "src/app/app.config.ts",
            code: `import { ApplicationConfig, provideAppInitializer } from "@angular/core";
import { provideRouter } from "@angular/router";
import { GrowthTracker } from "@trackme/tracker";
import { routes } from "./app.routes";
import { environment } from "../environments/environment";

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAppInitializer(() => {
      const tracker = new GrowthTracker({
        siteKey: environment.trackmeSiteKey,
        endpoint: environment.trackmeEndpoint,
      });
      tracker.init();
      (window as unknown as { growth: GrowthTracker }).growth = tracker;
    }),
  ],
};`,
          },
        ],
      },
    ],
    events: {
      title: "Track events from a component",
      snippets: [
        {
          lang: "typescript",
          filename: "src/app/pricing.component.ts",
          code: `import { Component, inject } from "@angular/core";
import { AnalyticsService } from "./analytics.service";

@Component({
  selector: "app-pricing",
  standalone: true,
  template: \`<button (click)="choose('team')">Choose Team</button>\`,
})
export class PricingComponent {
  private readonly analytics = inject(AnalyticsService);

  choose(plan: string) {
    this.analytics.track("plan_selected", { plan });
  }
}`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      MODULE_NOTE,
      {
        type: "warning",
        title: "Hash location strategy",
        text: "`withHashLocation()` keeps the route after `#`, which the tracker does not record. Use the default path location strategy.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "astro",
    name: "Astro",
    group: "Frameworks",
    tagline: "Astro sites, including view transitions.",
    language: "Astro / TypeScript",
    method: "Inline script tag in the layout",
    files: "src/layouts/Layout.astro",
    routing:
      "Full page loads are tracked on load. With view transitions (`ClientRouter`), navigations update the URL with the History API and are tracked automatically.",
    keywords: ["astro", "view transitions", "islands", "layout.astro", "is:inline"],
    steps: [
      {
        title: "Add the script to your layout",
        body: "Use `is:inline` so Astro leaves the tag alone instead of bundling it.",
        snippets: [
          {
            lang: "astro",
            filename: "src/layouts/Layout.astro",
            code: `---
const { title } = Astro.props;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <script
      is:inline
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    ></script>
  </head>
  <body>
    <slot />
  </body>
</html>`,
          },
        ],
      },
    ],
    events: {
      title: "Track events",
      body: "Astro component scripts run in the browser, so you can call `window.growth` directly.",
      snippets: [
        {
          lang: "astro",
          code: `<button id="contact">Contact sales</button>

<script>
  document.getElementById("contact")?.addEventListener("click", () => {
    (window as any).growth?.trackEvent("contact_sales_clicked");
  });
</script>`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      {
        type: "tip",
        text: "Do not add `data-astro-rerun` to the tracker script. It should load once per session, not on every view transition.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "gatsby",
    name: "Gatsby",
    group: "Frameworks",
    tagline: "Gatsby 4 and 5.",
    language: "JavaScript / TypeScript",
    method: "gatsby-ssr.js",
    files: "gatsby-ssr.js",
    routing: "Automatic. Gatsby's router uses the History API.",
    keywords: ["gatsby", "gatsby-ssr", "onRenderBody", "gatsby-browser"],
    steps: [
      {
        title: "Inject the script at build time",
        body: "`onRenderBody` runs during server rendering, so the tag is in the static HTML of every page.",
        snippets: [
          {
            lang: "jsx",
            filename: "gatsby-ssr.js",
            code: `import React from "react";

export const onRenderBody = ({ setHeadComponents }) => {
  setHeadComponents([
    <script
      key="trackme"
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    />,
  ]);
};`,
          },
        ],
      },
    ],
    events: {
      title: "Track events",
      snippets: [
        {
          lang: "jsx",
          code: `export default function Hero() {
  return (
    <button onClick={() => window.growth && window.growth.trackEvent("hero_cta_clicked")}>
      Get started
    </button>
  );
}`,
        },
      ],
    },
    notes: [
      SPA_NOTE,
      {
        type: "note",
        text: "`gatsby develop` does not run `gatsby-ssr.js` for every request. Test with `gatsby build && gatsby serve`.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "javascript-modules",
    name: "JavaScript modules",
    group: "Frameworks",
    tagline: "Any bundler: webpack, Vite, esbuild, Rollup, Parcel.",
    language: "JavaScript / TypeScript",
    method: "npm module",
    files: "Your app entry file",
    routing:
      "Automatic after `init()`. Pass `autoTrackSpa: false` only if you drive pageviews yourself.",
    keywords: ["module", "esm", "npm", "bundler", "webpack", "esbuild", "rollup", "GrowthTracker", "import"],
    steps: [
      {
        title: "Create and start the tracker",
        body: "Create one instance for the page and call `init()` once.",
        snippets: [
          {
            lang: "typescript",
            filename: "src/analytics.ts",
            code: `import { GrowthTracker } from "@trackme/tracker";

export const tracker = new GrowthTracker({
  siteKey: "YOUR_SITE_KEY",
  endpoint: "https://ingest.example.com/v1/batch",
  respectDNT: true,       // default
  collectWebVitals: true, // default
  autoTrackSpa: true,     // default
});

tracker.init();`,
          },
        ],
      },
      {
        title: "Use it anywhere",
        snippets: [
          {
            lang: "typescript",
            code: `import { tracker } from "./analytics";

tracker.trackEvent("report_exported", { format: "csv", rows: 1200 });
tracker.trackGoal("trial_started");
tracker.trackFunnelStep("checkout", "payment_details");
tracker.identify("user_8421", { plan: "pro" });`,
          },
        ],
      },
    ],
    events: {
      title: "Typed event helper",
      body: "A small wrapper gives you autocomplete for the event names you use.",
      snippets: [
        {
          lang: "typescript",
          code: `import { tracker } from "./analytics";

type AppEvents = {
  signup_completed: { plan: "free" | "pro" };
  report_exported: { format: "csv" | "pdf"; rows: number };
};

export function track<K extends keyof AppEvents>(name: K, props: AppEvents[K]) {
  tracker.trackEvent(name, props);
}

track("report_exported", { format: "csv", rows: 1200 });`,
        },
      ],
    },
    consent: {
      title: "Hold tracking until the visitor agrees",
      snippets: [
        {
          lang: "typescript",
          code: `const tracker = new GrowthTracker({
  siteKey: "YOUR_SITE_KEY",
  endpoint: "https://ingest.example.com/v1/batch",
  requireConsent: true,
});

tracker.init(); // stays idle

acceptButton.addEventListener("click", () => tracker.grantConsent());
declineButton.addEventListener("click", () => tracker.denyConsent());`,
        },
      ],
    },
    notes: [
      MODULE_NOTE,
      {
        type: "note",
        text: "The package builds an ES module, a CommonJS module and a standalone script (`tracker.global.js`, the file the script tag loads). Route adapters for custom routers are in `@trackme/tracker/adapters`.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "wordpress",
    name: "WordPress",
    group: "Platforms & CMS",
    tagline: "Themes, block themes and WooCommerce.",
    language: "PHP",
    method: "Script tag via wp_head, or a plugin",
    files: "functions.php of a child theme, or a header-scripts plugin",
    routing: "Every page view is a full page load. Block themes and WooCommerce navigate with normal loads.",
    keywords: ["wordpress", "wp", "woocommerce", "php", "functions.php", "wp_head", "child theme"],
    steps: [
      {
        title: "Option A: a header-scripts plugin (no code)",
        body: "Install any plugin that adds code to the site header, such as WPCode or Insert Headers and Footers. Paste the snippet into its header box.",
        snippets: [{ lang: "html", code: SCRIPT_TAG }],
      },
      {
        title: "Option B: add it from your child theme",
        body: "Put this in `functions.php` of a **child theme** so a theme update does not remove it. It skips administrators so your own visits are not counted.",
        snippets: [
          {
            lang: "php",
            filename: "functions.php",
            code: `<?php
add_action('wp_head', function () {
    if (current_user_can('manage_options')) {
        return; // do not count site administrators
    }
    ?>
    <script
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    ></script>
    <?php
}, 1);`,
          },
        ],
      },
    ],
    events: {
      title: "Track a WooCommerce purchase",
      body: "Print an inline script on the order-received page. It waits for the tracker, which loads deferred.",
      snippets: [
        {
          lang: "php",
          filename: "functions.php",
          code: `<?php
add_action('woocommerce_thankyou', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) {
        return;
    }
    $payload = wp_json_encode([
        'order_total' => (float) $order->get_total(),
        'currency'    => $order->get_currency(),
        'items'       => (int) $order->get_item_count(),
    ]);
    ?>
    <script>
      document.addEventListener('DOMContentLoaded', function () {
        window.growth && window.growth.trackEvent('purchase', <?php echo $payload; ?>);
      });
    </script>
    <?php
});`,
        },
      ],
    },
    identify: {
      title: "Identify logged-in members",
      snippets: [
        {
          lang: "php",
          code: `<?php
add_action('wp_footer', function () {
    if (!is_user_logged_in()) {
        return;
    }
    $id = (string) get_current_user_id();
    ?>
    <script>
      document.addEventListener('DOMContentLoaded', function () {
        window.growth && window.growth.identify(<?php echo wp_json_encode($id); ?>);
      });
    </script>
    <?php
});`,
        },
      ],
    },
    notes: [
      {
        type: "warning",
        title: "Caching and optimisation plugins",
        text: "Script-deferral and minification plugins can rewrite or delay the tag. If events do not arrive, exclude `tracker.js` from \"delay JavaScript\" and \"combine JavaScript\" settings.",
      },
      {
        type: "note",
        text: "Add the registered domain of your site in the dashboard exactly as visitors see it (for example `example.com`). Events from other hosts are dropped.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "shopify",
    name: "Shopify",
    group: "Platforms & CMS",
    tagline: "Online Store themes written in Liquid.",
    language: "Liquid",
    method: "Script tag in theme.liquid",
    files: "layout/theme.liquid",
    routing: "Storefront pages are full page loads.",
    keywords: ["shopify", "liquid", "theme.liquid", "dawn", "storefront", "ecommerce", "checkout"],
    steps: [
      {
        title: "Edit the theme",
        body: "In the Shopify admin go to **Online Store → Themes → Edit code**, open `layout/theme.liquid`, and paste the tag just before `</head>`. Duplicate the theme first so you can roll back.",
        snippets: [
          {
            lang: "liquid",
            filename: "layout/theme.liquid",
            code: `    {{ content_for_header }}

    <script
      defer
      src="https://app.example.com/tracker.js"
      data-site="YOUR_SITE_KEY"
      data-endpoint="https://ingest.example.com/v1/batch"
    ></script>
  </head>`,
          },
        ],
      },
    ],
    events: {
      title: "Track add-to-cart",
      body: "A document-level listener catches the theme's add-to-cart form without editing each template.",
      snippets: [
        {
          lang: "liquid",
          code: `<script>
  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (form && form.action && form.action.indexOf('/cart/add') !== -1) {
        window.growth && window.growth.trackEvent('add_to_cart', {
          product: {{ product.handle | json }}
        });
      }
    });
  });
</script>`,
        },
      ],
    },
    identify: {
      title: "Identify logged-in customers",
      snippets: [
        {
          lang: "liquid",
          code: `{% if customer %}
<script>
  document.addEventListener('DOMContentLoaded', function () {
    window.growth && window.growth.identify({{ customer.id | json }});
  });
</script>
{% endif %}`,
        },
      ],
    },
    notes: [
      {
        type: "warning",
        title: "Checkout pages",
        text: "On most Shopify plans, scripts in `theme.liquid` do not run on the checkout. To measure checkout steps you need Shopify's customer events (custom pixels). That is separate from this tag.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "google-tag-manager",
    name: "Google Tag Manager",
    group: "Platforms & CMS",
    tagline: "Deploy the tracker as a Custom HTML tag.",
    language: "HTML",
    method: "Custom HTML tag",
    files: "Your GTM container",
    routing: "The tracker watches the History API itself. Do not add a History Change trigger.",
    keywords: ["gtm", "google tag manager", "tag manager", "custom html", "container", "trigger", "consent mode"],
    steps: [
      {
        title: "Create a Custom HTML tag",
        body: "In your container choose **Tags → New → Custom HTML** and paste the snippet. Leave **Support document.write** off.",
        snippets: [{ lang: "html", code: SCRIPT_TAG }],
      },
      {
        title: "Fire it once per page load",
        body: "Use the **Initialization – All Pages** trigger so the tracker starts before other tags. Set the tag firing option to **Once per page**.",
      },
      {
        title: "Preview and publish",
        body: "Use GTM Preview on your site, confirm the tag fired, then publish. Check **Realtime** in the dashboard.",
      },
    ],
    events: {
      title: "Track events with a second tag",
      body: "Create another Custom HTML tag with a trigger of your choice, for example a click trigger on a specific button.",
      snippets: [
        {
          lang: "html",
          code: `<script>
  window.growth && window.growth.trackEvent("cta_clicked", {
    label: {{Click Text}},
    page: {{Page Path}}
  });
</script>`,
        },
      ],
    },
    consent: {
      title: "Respect your consent banner",
      body: "Give the tracker tag a trigger that only fires after consent, or load it with `data-require-consent=\"true\"` and call `grantConsent()` from a tag that fires on the consent event.",
      snippets: [
        {
          lang: "html",
          code: `<script>
  window.growth && window.growth.grantConsent();
</script>`,
        },
      ],
    },
    notes: [
      {
        type: "warning",
        title: "One loader only",
        text: "If the script is also in your site's HTML, remove one of them. Two copies send every event twice.",
      },
      {
        type: "note",
        text: "Tag blockers and some privacy browsers block GTM itself, so installs through GTM can miss more traffic than a script tag in your own HTML.",
      },
    ],
  },

  /* ----------------------------------------------------------------------- */
  {
    slug: "site-builders",
    name: "Webflow, Squarespace, Wix & more",
    group: "Platforms & CMS",
    tagline: "Hosted site builders with a custom-code setting.",
    language: "HTML",
    method: "Custom code in site settings",
    files: "Site-wide header code",
    routing: "Pages load normally; tracked on each load.",
    keywords: ["webflow", "squarespace", "wix", "framer", "ghost", "carrd", "hubspot", "no-code", "site builder", "custom code"],
    steps: [
      {
        title: "Find the custom code setting",
        body: "Look in site settings for **Custom code**, **Code injection**, or **Header code**. The name differs by product; you want the area that ends up in `<head>` on every page.",
      },
      {
        title: "Paste the snippet",
        snippets: [{ lang: "html", code: SCRIPT_TAG }],
      },
      {
        title: "Publish and test",
        body: "Most builders only add custom code to the published site, not the editor preview. Publish, open the live URL, and look for your visit in **Realtime**.",
      },
    ],
    events: {
      title: "Track a form or button",
      body: "Add a small script in the same custom-code area, targeting your element's selector.",
      snippets: [
        {
          lang: "html",
          code: `<script>
  document.addEventListener("DOMContentLoaded", function () {
    var button = document.querySelector("#book-demo");
    if (!button) return;
    button.addEventListener("click", function () {
      window.growth && window.growth.trackEvent("book_demo_clicked");
    });
  });
</script>`,
        },
      ],
    },
    notes: [
      {
        type: "note",
        title: "Plan limits",
        text: "Some builders only allow custom code on paid plans. If the setting is missing, check your plan.",
      },
      {
        type: "note",
        text: "Register the domain exactly as visitors see it, including `www` if you use it, or use a registered parent domain. Events from other hosts are dropped.",
      },
    ],
  },
];

export function getFramework(slug: string): Framework | undefined {
  return FRAMEWORKS.find((framework) => framework.slug === slug);
}

export const FRAMEWORK_GROUPS = ["Frameworks", "Platforms & CMS"] as const;
