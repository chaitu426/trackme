import * as React from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronDown,
  Database,
  Fingerprint,
  Gauge,
  Globe2,
  LockKeyhole,
  Radio,
  ShieldCheck,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
import { SmartLink } from "./smart-link";
import { ProductPreview } from "./preview";

export interface LandingLinks {
  /** Docs home. */
  docs: string;
  quickstart: string;
  frameworks: string;
  reference?: string;
  selfHosting?: string;
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
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 text-sm font-semibold text-white shadow-[0_8px_28px_-10px_rgba(59,130,246,0.75)] transition hover:bg-blue-400";
const outlineButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-5 text-sm font-medium text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06]";

const BENEFITS = [
  { icon: Fingerprint, label: "No tracking cookies" },
  { icon: Radio, label: "Live activity" },
  { icon: Gauge, label: "Real-user Web Vitals" },
  { icon: Workflow, label: "Funnels and goals" },
] as const;

const FEATURES = [
  {
    icon: Radio,
    eyebrow: "Know what is happening now",
    title: "Realtime, not yesterday’s news",
    body: "See active visitors and the pages they are viewing, updated from the events arriving at your site.",
  },
  {
    icon: Workflow,
    eyebrow: "Follow the moments that matter",
    title: "Events, goals and funnels",
    body: "Track meaningful actions, define conversion goals, and see where people move through a multi-step journey.",
  },
  {
    icon: Gauge,
    eyebrow: "Measure the experience",
    title: "Web Vitals from real visits",
    body: "Understand LCP, INP, CLS, FCP and TTFB with p75 summaries and useful page and device breakdowns.",
  },
  {
    icon: UserRound,
    eyebrow: "Connect product activity",
    title: "People, in context",
    body: "Associate activity with your own user identifiers to understand what happens before and after key actions.",
  },
  {
    icon: ShieldCheck,
    eyebrow: "Respect the people behind the data",
    title: "Privacy controls that matter",
    body: "Cookieless collection, optional consent gating, per-site Do Not Track support and domain allow-listing.",
  },
  {
    icon: Database,
    eyebrow: "Keep control of your stack",
    title: "Your data, your infrastructure",
    body: "Self-host with a production-oriented stack built around ClickHouse, PostgreSQL, Redis and Kafka.",
  },
] as const;

const STACKS = [
  "React",
  "Next.js",
  "Vue",
  "Nuxt",
  "Angular",
  "SvelteKit",
  "Astro",
  "WordPress",
  "Shopify",
  "Laravel",
  "Rails",
  "Django",
] as const;

const FAQS = [
  {
    question: "Does TrackMe use analytics cookies?",
    answer:
      "The browser tracker is designed to collect analytics without setting tracking cookies. You can also configure consent gating for sites that require it.",
  },
  {
    question: "What can I measure with TrackMe?",
    answer:
      "TrackMe supports pageviews, custom events, goals and funnels, realtime activity, acquisition and geography reports, people profiles, and Core Web Vitals.",
  },
  {
    question: "How do I add the tracker to my site?",
    answer:
      "Add a deferred script tag with your site key and ingestion endpoint. Use the quickstart for the basic setup or choose a framework guide for a platform-specific example.",
  },
  {
    question: "Can I run the platform on my own infrastructure?",
    answer:
      "Yes. The repository includes a self-hostable stack using PostgreSQL, ClickHouse, Redis, Kafka and the TrackMe services. See the operations documentation for deployment details.",
  },
  {
    question: "Is the dashboard preview showing live customer data?",
    answer:
      "No. The dashboard illustration on this page uses sample data for demonstration only; it is not connected to an account.",
  },
] as const;

/** The tag itself, with light syntax colouring and no runtime dependency. */
function Snippet() {
  return (
    <figure className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#0c0e13] shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)]">
      <figcaption className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.02] px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
          <span className="h-2 w-2 rounded-full bg-blue-400" />
          index.html
        </span>
        <span className="rounded-md border border-white/[0.07] px-2 py-1 text-[10px] text-zinc-500">
          before &lt;/head&gt;
        </span>
      </figcaption>
      <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.9] text-zinc-300 sm:text-[13px]">
        <code>
          <span className="text-zinc-600">{"<"}</span>
          <span className="text-sky-300">script</span>
          {"\n"}
          {"  "}
          <span className="text-blue-300">defer</span>
          {"\n"}
          {"  "}
          <span className="text-blue-300">src</span>
          <span className="text-zinc-500">=</span>
          <span className="text-emerald-300">&quot;https://app.example.com/tracker.js&quot;</span>
          {"\n"}
          {"  "}
          <span className="text-blue-300">data-site</span>
          <span className="text-zinc-500">=</span>
          <span className="text-amber-200">&quot;YOUR_SITE_KEY&quot;</span>
          {"\n"}
          {"  "}
          <span className="text-blue-300">data-endpoint</span>
          <span className="text-zinc-500">=</span>
          <span className="text-emerald-300">&quot;https://ingest.example.com/v1/batch&quot;</span>
          {"\n"}
          <span className="text-zinc-600">{">"}</span>
          <span className="text-zinc-600">{"</"}</span>
          <span className="text-sky-300">script</span>
          <span className="text-zinc-600">{">"}</span>
        </code>
      </pre>
      <div className="flex items-center gap-2 border-t border-white/[0.06] bg-white/[0.015] px-4 py-3 text-[11px] text-zinc-500">
        <Zap className="h-3.5 w-3.5 text-blue-400" />
        Deferred loading · automatic SPA navigation · batched delivery
      </div>
    </figure>
  );
}

function SectionIntro({
  eyebrow,
  title,
  children,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-400">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] text-zinc-50 sm:text-[2.6rem]">
        {title}
      </h2>
      {children && <p className="mt-4 text-[15px] leading-7 text-zinc-400">{children}</p>}
    </div>
  );
}

function PrivacyCard() {
  const items = [
    ["01", "No tracking cookies", "Understand journeys without a cookie-based identifier."],
    ["02", "Transient IP handling", "IP is used at the edge for geolocation, then discarded."],
    ["03", "Respect visitor choices", "Configure consent gating and per-site DNT support."],
    ["04", "Choose your retention", "Set retention for the data that matters to your team."],
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0e13] p-5 sm:p-7">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/[0.09] blur-3xl" />
      <div className="relative flex items-center justify-between border-b border-white/[0.07] pb-5">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Privacy controls</p>
          <p className="mt-1 text-xs text-zinc-500">Built into the collection model</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/[0.08] text-blue-300">
          <ShieldCheck className="h-5 w-5" />
        </span>
      </div>
      <ul className="relative divide-y divide-white/[0.06]">
        {items.map(([number, title, body]) => (
          <li key={number} className="flex gap-4 py-4 first:pt-5 last:pb-1">
            <span className="pt-0.5 font-mono text-[10px] text-blue-400/80">{number}</span>
            <div>
              <p className="text-[13px] font-medium text-zinc-200">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{body}</p>
            </div>
            <Check className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-emerald-400/80" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventFlow() {
  const stages = [
    { icon: Globe2, title: "Your site", detail: "Lightweight browser tracker", color: "text-sky-300" },
    { icon: Radio, title: "Go edge", detail: "Validate · rate-limit · route", color: "text-blue-300" },
    { icon: Workflow, title: "Event stream", detail: "Reliable Kafka delivery", color: "text-violet-300" },
    { icon: Database, title: "Your insights", detail: "ClickHouse + live dashboard", color: "text-emerald-300" },
  ] as const;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0d12]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div>
          <p className="text-sm font-semibold text-zinc-100">From event to insight</p>
          <p className="mt-1 text-xs text-zinc-500">A look at the TrackMe collection path</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-2.5 py-1 text-[10px] font-medium text-emerald-300">
          <span className="pulse-live h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Built for reliable delivery
        </span>
      </div>
      <ol className="grid divide-y divide-white/[0.06] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {stages.map(({ icon: Icon, title, detail, color }, index) => (
          <li key={title} className="relative flex items-start gap-3 p-5 sm:flex-col sm:gap-5 sm:p-6">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025] ${color}`}>
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <span className="font-mono text-[10px] text-zinc-600">0{index + 1}</span>
              <h3 className="mt-1 text-[13px] font-semibold text-zinc-100">{title}</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{detail}</p>
            </div>
            {index < stages.length - 1 && (
              <ArrowRight className="absolute right-5 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-zinc-700 sm:block" />
            )}
            {index < stages.length - 1 && (
              <ArrowDownRight className="absolute bottom-3 right-5 h-3.5 w-3.5 text-zinc-700 sm:hidden" />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Landing({ product = "TrackMe", links }: LandingProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground antialiased selection:bg-blue-500/30">
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#09090b]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <SmartLink href="/" className="flex shrink-0 items-center gap-2.5" aria-label={`${product} home`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white shadow-[0_4px_16px_-5px_rgba(59,130,246,0.8)]">
              <Activity className="h-4 w-4" strokeWidth={2.4} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-zinc-50">{product}</span>
          </SmartLink>

          <nav aria-label="Primary" className="hidden items-center gap-7 text-[13px] text-zinc-400 md:flex">
            <a href="#features" className="transition hover:text-zinc-100">Features</a>
            <a href="#privacy" className="transition hover:text-zinc-100">Privacy</a>
            <a href="#install" className="transition hover:text-zinc-100">Install</a>
            <SmartLink href={links.docs} className="transition hover:text-zinc-100">Docs</SmartLink>
          </nav>

          <div className="flex items-center gap-2">
            {links.signIn && (
              <SmartLink
                href={links.signIn}
                className="hidden h-9 items-center rounded-lg px-3 text-[13px] font-medium text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100 sm:inline-flex"
              >
                Sign in
              </SmartLink>
            )}
            <SmartLink href={links.getStarted} className={`${primaryButton} h-9 px-3.5 text-[12px]`}>
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </SmartLink>
          </div>
        </div>
      </header>

      <main>
        <section id="product" className="relative border-b border-white/[0.06]">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[34rem] bg-[radial-gradient(ellipse_55%_55%_at_50%_0%,rgba(37,99,235,0.16),transparent)]" />
          <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-20 sm:px-8 sm:pb-20 sm:pt-28">
            <div className="mx-auto max-w-4xl text-center">
              <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/[0.06] px-3.5 py-1.5 text-[11px] font-medium text-blue-200">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                Privacy-first product analytics
              </p>
              <h1 className="mt-7 text-balance text-[2.65rem] font-semibold leading-[1.04] tracking-[-0.055em] text-zinc-50 sm:text-6xl lg:text-[4.5rem]">
                Know what your visitors do.
                <span className="block bg-gradient-to-r from-blue-300 via-sky-200 to-indigo-300 bg-clip-text text-transparent">
                  Respect who they are.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-zinc-400 sm:text-lg sm:leading-8">
                The signals to grow your product—pageviews, funnels, realtime and Web Vitals—without building your
                analytics around invasive tracking.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <SmartLink href={links.getStarted} className={`${primaryButton} w-full sm:w-auto`}>
                  Start with TrackMe <ArrowRight className="h-4 w-4" />
                </SmartLink>
                <SmartLink href={links.docs} className={`${outlineButton} w-full sm:w-auto`}>
                  Explore the docs
                </SmartLink>
              </div>
            </div>

            <div className="mx-auto mt-14 max-w-5xl sm:mt-16">
              <ProductPreview />
              <p className="mt-3 text-center text-[11px] text-zinc-600">
                A product illustration with sample data—not a live account.
              </p>
            </div>

            <ul className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              {BENEFITS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center justify-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-3 text-center text-[11px] font-medium text-zinc-400 sm:text-xs"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-blue-300" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="privacy" className="border-b border-white/[0.06] bg-[#0a0b0e]">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <SectionIntro eyebrow="Less noise. More clarity." title="Useful analytics, without the baggage.">
                Understand what’s working without turning your product into a surveillance system. Privacy is part of
                how TrackMe collects—not a setting you have to discover later.
              </SectionIntro>
              <ul className="mt-8 space-y-3">
                {[
                  "No analytics tracking cookies",
                  "Transient IP processing for geolocation",
                  "Consent controls and per-site DNT support",
                  "Configurable data retention",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-zinc-300">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-400/10 text-blue-300">
                      <Check className="h-3 w-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              {links.privacy && (
                <SmartLink href={links.privacy} className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-blue-300 transition hover:text-blue-200">
                  Read the privacy overview <ArrowRight className="h-4 w-4" />
                </SmartLink>
              )}
            </div>
            <PrivacyCard />
          </div>
        </section>

        <section id="features" className="border-b border-white/[0.06]">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <SectionIntro eyebrow="The full picture" title="Everything you need to understand your traffic.">
              The important signals, connected in one place—from the first pageview to the moment someone becomes a
              customer.
            </SectionIntro>
            <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, eyebrow, title, body }, index) => (
                <li
                  key={title}
                  className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#0b0c10] p-6 transition duration-200 hover:-translate-y-0.5 hover:border-blue-400/25 hover:bg-[#0d1017]"
                >
                  <span className="absolute right-5 top-5 font-mono text-[10px] text-zinc-700">0{index + 1}</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-400/[0.07] text-blue-300 transition group-hover:border-blue-300/30 group-hover:bg-blue-400/[0.12]">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.12em] text-blue-300/80">{eyebrow}</p>
                  <h3 className="mt-2 text-[17px] font-semibold tracking-tight text-zinc-100">{title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-zinc-500">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-b border-white/[0.06] bg-[#0a0b0e]">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <SectionIntro eyebrow="Under the hood" title="Built for the journey from event to insight." />
              <p className="max-w-md text-sm leading-6 text-zinc-500">
                A lightweight browser tracker feeds a dedicated ingestion path, then a reliable event pipeline and
                analytics store.
              </p>
            </div>
            <EventFlow />
          </div>
        </section>

        <section id="install" className="border-b border-white/[0.06]">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <SectionIntro eyebrow="Up and running, simply" title="One small tag. A clearer picture.">
                Add the deferred tracker, use your site key, and start collecting the events that help you make better
                product decisions.
              </SectionIntro>
              <ul className="mt-7 space-y-3 text-[13px] text-zinc-400">
                <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Loads deferred so it doesn’t block page rendering.</li>
                <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Tracks single-page navigation without router glue.</li>
                <li className="flex gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Batches events and retries when the network drops.</li>
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <SmartLink href={links.quickstart} className={primaryButton}>
                  Read the quickstart <ArrowRight className="h-4 w-4" />
                </SmartLink>
                <SmartLink href={links.frameworks} className={outlineButton}>Framework guides</SmartLink>
              </div>
            </div>
            <Snippet />
          </div>
          <div className="mx-auto max-w-7xl px-5 pb-16 sm:px-8 sm:pb-20">
            <p className="mb-4 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">
              Guides for the tools you already use
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-2">
              {STACKS.map((stack) => (
                <li key={stack} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-400">
                  {stack}
                </li>
              ))}
              <li className="rounded-lg border border-dashed border-white/[0.1] px-3 py-1.5 text-xs text-zinc-500">
                Any site that can add a script
              </li>
            </ul>
          </div>
        </section>

        <section id="faq" className="border-b border-white/[0.06] bg-[#0a0b0e]">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
            <div>
              <SectionIntro eyebrow="Good to know" title="A few things you might be wondering.">
                Straight answers about how TrackMe works and what you can do with it.
              </SectionIntro>
              <SmartLink href={links.docs} className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-blue-300 transition hover:text-blue-200">
                Browse the documentation <ArrowRight className="h-4 w-4" />
              </SmartLink>
            </div>
            <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
              {FAQS.map(({ question, answer }) => (
                <details key={question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-sm font-medium text-zinc-200 marker:content-none [&::-webkit-details-marker]:hidden">
                    {question}
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition group-open:rotate-180 group-open:text-blue-300" />
                  </summary>
                  <p className="max-w-2xl pr-8 pt-3 text-[13px] leading-6 text-zinc-500">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_100%,rgba(37,99,235,0.16),transparent)]" />
          <div className="relative mx-auto max-w-5xl px-5 py-20 text-center sm:px-8 sm:py-28">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/[0.08] text-blue-300">
              <LockKeyhole className="h-5 w-5" />
            </span>
            <h2 className="mx-auto mt-6 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] text-zinc-50 sm:text-5xl">
              Make better decisions.
              <span className="block text-blue-300">Keep your values intact.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-7 text-zinc-400">
              Get the product signals your team needs, with a stack you can understand and privacy choices you can
              explain.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <SmartLink href={links.getStarted} className={`${primaryButton} w-full sm:w-auto`}>
                Get started with TrackMe <ArrowRight className="h-4 w-4" />
              </SmartLink>
              <SmartLink href={links.quickstart} className={`${outlineButton} w-full sm:w-auto`}>
                Read the quickstart
              </SmartLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.07] bg-[#08090c]">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-10 sm:px-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <SmartLink href="/" className="inline-flex items-center gap-2.5" aria-label={`${product} home`}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500 text-white">
                <Activity className="h-3.5 w-3.5" strokeWidth={2.4} />
              </span>
              <span className="text-sm font-semibold text-zinc-100">{product}</span>
            </SmartLink>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              Privacy-first web analytics for product and growth teams.
            </p>
            <p className="mt-5 text-[10px] text-zinc-700">© {new Date().getFullYear()} {product}</p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-3 text-[13px] sm:grid-cols-3">
            <FooterLink href={links.docs}>Documentation</FooterLink>
            <FooterLink href={links.quickstart}>Quickstart</FooterLink>
            <FooterLink href={links.frameworks}>Framework guides</FooterLink>
            {links.reference && <FooterLink href={links.reference}>API reference</FooterLink>}
            {links.selfHosting && <FooterLink href={links.selfHosting}>Self-hosting</FooterLink>}
            {links.privacy && <FooterLink href={links.privacy}>Privacy overview</FooterLink>}
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
