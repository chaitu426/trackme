import * as React from "react";
import {
  Activity,
  ArrowRight,
  Database,
  Filter,
  Gauge,
  Radio,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { SmartLink } from "./smart-link";
import { ProductPreview } from "./preview";

export interface LandingLinks {
  /** Docs home. */
  docs: string;
  quickstart: string;
  frameworks: string;
  reference: string;
  selfHosting: string;
  /** Omit to hide the "Sign in" link. */
  signIn?: string;
  /** Primary call to action. */
  getStarted: string;
  privacy?: string;
}

export interface LandingProps {
  product?: string;
  links: LandingLinks;
}

const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-100 px-5 text-sm font-medium text-zinc-950 transition hover:bg-white";
const outlineButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-50";

const FEATURES = [
  {
    icon: Radio,
    title: "Realtime",
    body: "See who is on your site and which pages they are reading, updated every second.",
  },
  {
    icon: Filter,
    title: "Funnels and goals",
    body: "Define conversion goals and multi-step funnels from pageviews or your own events.",
  },
  {
    icon: Gauge,
    title: "Web Vitals",
    body: "LCP, INP, CLS, FCP and TTFB from real visitors, summarised at the 75th percentile.",
  },
  {
    icon: UserCheck,
    title: "User profiles",
    body: "Identify signed-in users with your own ids and follow their activity over time.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy controls",
    body: "No cookies. Per-site Do Not Track, consent gating, domain allow-listing and signed requests.",
  },
  {
    icon: Database,
    title: "Your data, your infrastructure",
    body: "Self-host the whole stack on ClickHouse, Postgres, Redis and Kafka, with configurable retention.",
  },
] as const;

const STEPS = [
  {
    title: "Add the tag",
    body: "Paste one script into your site, or follow the guide for your framework.",
  },
  {
    title: "Events are collected",
    body: "Pageviews, navigation and your custom events are batched, validated and stored.",
  },
  {
    title: "Explore the dashboard",
    body: "Break traffic down by page, source, country and device, and watch it live.",
  },
] as const;

const STACKS = ["React", "Next.js", "Vue", "Nuxt", "Angular", "SvelteKit", "Astro", "WordPress", "Shopify", "Laravel", "Rails", "Django"];

/** The tag itself, with light syntax colouring and no runtime dependency. */
function Snippet() {
  return (
    <figure className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e]">
      <figcaption className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2">
        <span className="font-mono text-[11px] text-zinc-500">index.html</span>
        <span className="text-[11px] text-zinc-600">before &lt;/head&gt;</span>
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.75] text-zinc-300">
        <code>
          <span className="text-zinc-500">{"<"}</span>
          <span className="text-emerald-300">script</span>
          {"\n"}
          {"  "}
          <span className="text-sky-300">defer</span>
          {"\n"}
          {"  "}
          <span className="text-sky-300">src</span>
          <span className="text-zinc-500">=</span>
          <span className="text-amber-200">&quot;https://app.example.com/tracker.js&quot;</span>
          {"\n"}
          {"  "}
          <span className="text-sky-300">data-site</span>
          <span className="text-zinc-500">=</span>
          <span className="text-amber-200">&quot;YOUR_SITE_KEY&quot;</span>
          {"\n"}
          {"  "}
          <span className="text-sky-300">data-endpoint</span>
          <span className="text-zinc-500">=</span>
          <span className="text-amber-200">&quot;https://ingest.example.com/v1/batch&quot;</span>
          {"\n"}
          <span className="text-zinc-500">{">"}</span>
          <span className="text-zinc-500">{"</"}</span>
          <span className="text-emerald-300">script</span>
          <span className="text-zinc-500">{">"}</span>
        </code>
      </pre>
    </figure>
  );
}

export function Landing({ product = "TrackMe", links }: LandingProps) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-blue-500/30">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
          <div className="flex items-center gap-8">
            <SmartLink href="/" className="flex items-center gap-2.5" aria-label={`${product} home`}>
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-950">
                <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
              <span className="text-[14px] font-semibold tracking-tight text-zinc-50">{product}</span>
            </SmartLink>
            <nav aria-label="Primary" className="hidden items-center gap-6 text-[13px] text-zinc-400 md:flex">
              <a href="#product" className="transition hover:text-zinc-100">
                Product
              </a>
              <a href="#install" className="transition hover:text-zinc-100">
                Install
              </a>
              <a href="#features" className="transition hover:text-zinc-100">
                Features
              </a>
              <SmartLink href={links.docs} className="transition hover:text-zinc-100">
                Docs
              </SmartLink>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {links.signIn && (
              <SmartLink
                href={links.signIn}
                className="hidden h-8 items-center rounded-md px-3 text-[13px] font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 sm:inline-flex"
              >
                Sign in
              </SmartLink>
            )}
            <SmartLink
              href={links.getStarted}
              className="inline-flex h-8 items-center rounded-md bg-zinc-100 px-3.5 text-[13px] font-medium text-zinc-950 transition hover:bg-white"
            >
              Get started
            </SmartLink>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section
          id="product"
          className="relative overflow-hidden border-b border-white/[0.06] bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(59,130,246,0.14),transparent)]"
        >
          <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Cookieless web analytics
              </p>
              <h1 className="text-balance text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.035em] text-zinc-50 sm:text-6xl">
                Know what your visitors do, without tracking them.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg">
                Pageviews, funnels, realtime and Web Vitals from a single script tag. Built for product and growth teams
                that want clear answers without cookies or invasive tracking.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <SmartLink href={links.getStarted} className={`${primaryButton} w-full sm:w-auto`}>
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </SmartLink>
                <SmartLink href={links.docs} className={`${outlineButton} w-full sm:w-auto`}>
                  Read the docs
                </SmartLink>
              </div>
            </div>

            <div className="mx-auto mt-16 max-w-5xl">
              <ProductPreview />
              <p className="mt-3 text-center text-xs text-zinc-600">
                Illustration with sample data, not a live account.
              </p>
            </div>
          </div>
        </section>

        {/* Install */}
        <section id="install" className="border-b border-white/[0.06]">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-blue-400">Install</p>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">
                One tag. That is the whole integration.
              </h2>
              <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-zinc-400">
                <li className="flex gap-3">
                  <Check />
                  Loads deferred, so it never blocks rendering.
                </li>
                <li className="flex gap-3">
                  <Check />
                  Follows single-page navigation on its own, with no router code.
                </li>
                <li className="flex gap-3">
                  <Check />
                  Batches events and retries when the network drops.
                </li>
              </ul>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <SmartLink href={links.quickstart} className={primaryButton}>
                  Quickstart
                  <ArrowRight className="h-4 w-4" />
                </SmartLink>
                <SmartLink href={links.frameworks} className={outlineButton}>
                  Framework guides
                </SmartLink>
              </div>
            </div>
            <Snippet />
          </div>

          <div className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
            <p className="mb-4 text-center text-xs text-zinc-600">Guides for</p>
            <ul className="flex flex-wrap items-center justify-center gap-2">
              {STACKS.map((stack) => (
                <li
                  key={stack}
                  className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 text-xs text-zinc-400"
                >
                  {stack}
                </li>
              ))}
              <li className="rounded-full border border-dashed border-white/[0.08] px-3 py-1 text-xs text-zinc-500">
                and anything that can add a script tag
              </li>
            </ul>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-blue-400">Features</p>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">
                Everything you need to understand your traffic.
              </h2>
            </div>
            <ul className="mt-12 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="bg-background p-6 transition hover:bg-white/[0.02]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-zinc-100">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section className="border-b border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-blue-400">How it works</p>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">
                From first tag to first insight in minutes.
              </h2>
            </div>
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-zinc-900 font-mono text-xs font-semibold text-zinc-300">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-zinc-100">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing call to action */}
        <section>
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6">
            <div className="rounded-2xl border border-white/[0.08] bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(59,130,246,0.12),transparent)] px-6 py-14 text-center sm:px-12">
              <h2 className="mx-auto max-w-xl text-balance text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">
                Start measuring in minutes.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-zinc-400">
                Create a site, copy one tag, and see your first visit appear in realtime.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <SmartLink href={links.getStarted} className={`${primaryButton} w-full sm:w-auto`}>
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </SmartLink>
                <SmartLink href={links.quickstart} className={`${outlineButton} w-full sm:w-auto`}>
                  Read the quickstart
                </SmartLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-950">
                <Activity className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span className="text-[13px] font-semibold text-zinc-100">{product}</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">Cookieless web analytics for product and growth teams.</p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-14 gap-y-3 text-[13px] sm:grid-cols-3">
            <FooterLink href={links.docs}>Documentation</FooterLink>
            <FooterLink href={links.quickstart}>Quickstart</FooterLink>
            <FooterLink href={links.frameworks}>Frameworks</FooterLink>
            <FooterLink href={links.reference}>API reference</FooterLink>
            <FooterLink href={links.selfHosting}>Self-hosting</FooterLink>
            {links.privacy && <FooterLink href={links.privacy}>Privacy</FooterLink>}
          </nav>
        </div>
      </footer>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <SmartLink href={href} className="text-zinc-500 transition hover:text-zinc-200">
      {children}
    </SmartLink>
  );
}

function Check() {
  return (
    <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M2.5 6.2 5 8.6l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
