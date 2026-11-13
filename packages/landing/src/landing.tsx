import * as React from "react";
import { ArrowRight, ArrowUpRight, Database, Globe2, Server, ShieldCheck, Workflow, type LucideIcon } from "lucide-react";
import { SmartLink } from "./smart-link";
import { HeroScene } from "./hero-scene";
import { GlyphField } from "./glyph-field";
import { DemoDashboard } from "./demo-dashboard";
import { DEMO_ANCHOR } from "./demo-bus";
import { Navbar } from "./navbar";
import { FeatureStage } from "./feature-stage";
import { PrivacyLedger } from "./privacy-ledger";
import { MoneyTrailDemo } from "./money-trail-demo";
import { LogoMark } from "./logo-mark";
import { InstallConsole } from "./install-console";
import { CopySnippet } from "./copy-snippet";
import { TryChips } from "./try-chips";
import { CountUp, Reveal, Spot } from "./motion";
import { RELEASE } from "./version";
import { Pricing, type PricingProps } from "./pricing";

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

/** The signed-in visitor, so the page greets them instead of asking them to sign in. */
export interface LandingViewer {
  name: string;
  /** Where the primary call to action goes: the user's workspace or the dashboard. */
  href: string;
  /** Primary call to action label while signed in. */
  cta?: string;
}

export interface LandingProps {
  product?: string;
  links: LandingLinks;
  viewer?: LandingViewer | undefined;
  /** The plans and prices. Omit to leave the pricing section out (the docs site does). */
  pricing?: PricingProps | undefined;
  /** The real tracker and ingest URLs for the install snippet. Without them the page shows placeholders. */
  snippet?: { scriptUrl: string; endpoint: string };
}

/* One neutral ramp, one accent. The glyph pictures are the only place with rich texture. */
const INK = "#0f0f10";
const PAGE = "#141415";

const primaryButton =
  "group inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ededed] px-5 text-[15px] font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98]";
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/[0.12] bg-[#232325]/80 px-5 text-[15px] font-medium text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[border-color,transform] duration-150 hover:border-white/[0.24] active:scale-[0.98]";

const FACTS: { prefix?: string; to: number; suffix?: string; label: string }[] = [
  { prefix: "< ", to: 10, suffix: " KB", label: "Gzipped tag, loaded deferred so it never blocks rendering" },
  { to: 0, label: "Tracking cookies, and no IP address stored after the country lookup" },
  { to: 24, suffix: " h", label: "Visitor IDs rotate daily, so a person can’t be followed across days" },
  { to: 30, suffix: " min", label: "Of inactivity ends a session, shared across all tabs of a browser" },
];

const PIPELINE: { icon: LucideIcon; title: string; detail: string; spec: string }[] = [
  { icon: Globe2, title: "Your site", detail: "A small tag batches events and retries when the network drops.", spec: "up to 50 events per request" },
  { icon: Server, title: "Go edge", detail: "Validates every event, applies rate limits, reads the country, drops the IP.", spec: "limits per IP and per site" },
  { icon: Workflow, title: "Event stream", detail: "Kafka delivery, so a slow database never loses what the edge accepted.", spec: "acks from every replica" },
  { icon: Database, title: "Your insights", detail: "ClickHouse storage with the live dashboard reading from it.", spec: "deduplicated by event ID" },
];

const FAQS = [
  {
    q: "Do I still need a cookie banner?",
    a: "TrackMe sets no tracking cookies and stores no IP address. Whether you need a banner depends on your jurisdiction and how you use the data, so check with your counsel. If you do need consent, the tag can wait for it before sending anything.",
  },
  {
    q: "How are visitors counted without cookies?",
    a: "Each browser gets a random pseudonym that rotates every 24 hours. Someone who returns on several days counts once per day. That keeps data unlinkable, and it also means counts differ from tools that follow people across days.",
  },
  {
    q: "Will the numbers match Google Analytics?",
    a: "They will usually be lower. Ad blockers, Safari and Brave protections, and Do Not Track settings all reduce what any privacy-first tool can see. Known bots are excluded.",
  },
  {
    q: "Where does my data live?",
    a: "In your own infrastructure. Events pass through a Go ingestion edge into Kafka and are stored in ClickHouse, and the dashboard reads from there.",
  },
  {
    q: "Can I share a dashboard without giving access?",
    a: "Yes. A public read-only link shows headline numbers, top pages and channels without a login.",
  },
];


function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** Every section opens the same way: a mono index, a hairline, a label, then the claim. */
function SectionHead({ index, label, title, lead }: { index: string; label: string; title: React.ReactNode; lead?: string }) {
  return (
    <Reveal>
      <div className="flex items-center gap-4 font-mono text-xs text-zinc-500">
        <span className="text-zinc-300">{index}</span>
        <span className="h-px w-10 bg-white/[0.16]" />
        <span>{label}</span>
      </div>
      <h2 className="mt-5 max-w-3xl text-balance text-[34px] font-medium leading-[40px] tracking-[-0.03em] text-zinc-50 sm:text-[48px] sm:leading-[52px]">{title}</h2>
      {lead && <p className="mt-4 max-w-xl text-[17px] leading-7 text-zinc-400">{lead}</p>}
    </Reveal>
  );
}

function Mark() {
  return <LogoMark size={24} />;
}

export function Landing({ product = "TrackMe", links, viewer, pricing, snippet }: LandingProps) {
  const scriptUrl = snippet?.scriptUrl ?? "https://your-app.com/t/v1/tracker.js";
  const endpoint = snippet?.endpoint ?? "https://ingest.your-app.com/v1/batch";
  const SNIPPET = `<script defer src="${scriptUrl}" data-site="YOUR_SITE_KEY" data-endpoint="${endpoint}"></script>`;
  const primaryHref = viewer?.href ?? links.getStarted;
  const primaryLabel = viewer ? (viewer.cta ?? "Go to workspace") : "Create workspace";

  return (
    <div className="min-h-screen bg-[#141415] text-zinc-100 antialiased [scroll-behavior:smooth]">
      <style>{`
        @keyframes heroTag { from { opacity: 0; transform: translate(-50%, calc(-50% + 6px)); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes heroLine { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes stageIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes stageBar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .hero-tag { opacity: 0; animation: heroTag 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        line.hero-tag { animation-name: heroLine; }
        .rise { opacity: 0; animation: rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .faq-item summary::-webkit-details-marker { display: none; }
        .faq-item[open] .faq-plus { transform: rotate(45deg); }
        .faq-item[open] { background: rgba(255,255,255,0.025); }
        @media (prefers-reduced-motion: reduce) { .hero-tag, .rise { animation: none; opacity: 1; } .rise, line.hero-tag { transform: none; } }
      `}</style>

      <Navbar product={product} links={{ docs: links.docs, signIn: links.signIn, getStarted: links.getStarted }} viewer={viewer} hasPricing={!!pricing} plan={pricing?.currentPlan} />

      {/* ------------------------------------------------------------ Hero */}
      <section id="product" className="relative overflow-hidden" style={{ backgroundColor: INK }}>
        <HeroScene />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[62%] bg-[linear-gradient(to_right,#0f0f10_0%,#0f0f10_54%,rgba(15,15,16,0)_100%)] md:block" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40" style={{ background: `linear-gradient(to bottom, rgba(15,15,16,0), ${PAGE})` }} />

        <Container className="relative z-20 pb-16 pt-36 md:min-h-[640px] md:pt-44">
          <div className="max-w-[720px]">
            <span className="rise inline-flex h-7 items-center gap-2 rounded-lg border border-white/[0.1] px-3 text-[13px] text-zinc-300">
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
              Realtime, down to the last five minutes
            </span>
            <h1 className="rise mt-6 text-balance text-[44px] font-medium leading-[46px] tracking-[-0.035em] text-zinc-50 [animation-delay:60ms] sm:text-[60px] sm:leading-[62px] lg:text-[68px] lg:leading-[70px]">
              Analytics for every team, <span className="text-zinc-500">not just the analyst.</span>
            </h1>
            <p className="rise mt-6 max-w-[540px] text-[17px] leading-7 text-zinc-300 [animation-delay:120ms] sm:text-lg sm:leading-[28px]">
              {product} gives marketing, engineering and product one workspace for live traffic, funnels, errors, release impact and payments, with each person seeing what their role needs. A tag under 10 KB, no tracking cookies, and no IP address ever stored.
            </p>
            <div className="rise mt-8 flex flex-wrap gap-3 [animation-delay:180ms]">
              <SmartLink href={primaryHref} className={primaryButton}>
                {primaryLabel} <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.5} />
              </SmartLink>
              <SmartLink href={links.docs} className={secondaryButton}>
                Read the docs
              </SmartLink>
            </div>
            <p className="rise mt-4 text-[13px] text-zinc-400 [animation-delay:240ms]">Works with React, Next.js, Vue, Svelte and Angular. Or one script tag.</p>
          </div>
        </Container>

        {/* The product, live */}
        <Container className="relative z-20 pb-24">
          <div id={DEMO_ANCHOR} className="scroll-mt-24">
            <div className="mb-4 px-1">
              <TryChips />
            </div>
            <DemoDashboard getStarted={primaryHref} startLabel={primaryLabel} />
          </div>
        </Container>
      </section>

      {/* ------------------------------------------------------------ Specs */}
      <section className="border-y border-white/[0.08]">
        <Container>
          <dl className="grid grid-cols-2 lg:grid-cols-4">
            {FACTS.map((fact, i) => (
              <Spot key={fact.label} className={`border-white/[0.08] ${i % 2 === 1 ? "border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i > 0 ? "lg:border-l" : ""}`}>
                <div className="px-5 py-9 sm:px-7">
                  <dt className="font-mono text-[34px] font-normal leading-10 text-zinc-50 tabular-nums">
                    <CountUp prefix={fact.prefix ?? ""} to={fact.to} suffix={fact.suffix ?? ""} />
                  </dt>
                  <dd className="mt-3 max-w-[220px] text-sm leading-5 text-zinc-400">{fact.label}</dd>
                </div>
              </Spot>
            ))}
          </dl>
        </Container>
      </section>

      {/* -------------------------------------------------------- Product */}
      <section id="features" className="pt-28 sm:pt-36">
        <Container>
          <SectionHead index="01" label="What you see" title="The questions your team asks every week, each with its own view." />
          <Reveal className="mt-14" delay={80}>
            <FeatureStage />
          </Reveal>
        </Container>
      </section>

      {/* ------------------------------------------------------------- Ask */}
      <section id="ask" className="pt-28 sm:pt-36">
        <Container>
          <SectionHead
            index="02"
            label="Ask"
            title={
              <>
                Other tools tell you what broke. <span className="text-zinc-500">{product} tells you what it cost.</span>
              </>
            }
            lead="Errors, releases, gateways, checkout sessions and payments live in one place, so a plain question can follow a problem from its cause to the rupees it cost. Every figure shows the query behind it."
          />
          <Reveal className="mt-14" delay={80}>
            <MoneyTrailDemo />
          </Reveal>
          <ul className="mt-8 grid gap-x-10 gap-y-4 text-sm leading-6 text-zinc-400 sm:grid-cols-3">
            <li><span className="text-zinc-200">Shows its work.</span> The exact query, the rows read and how long it took, for every number.</li>
            <li><span className="text-zinc-200">Says when it is guessing.</span> Estimates are labelled, and a question it cannot ground is declined, not made up.</li>
            <li><span className="text-zinc-200">Stays with you.</span> Watch a finding so you hear next time, or copy it as a case file or a ticket.</li>
          </ul>
        </Container>
      </section>

      {/* ---------------------------------------------------------- System */}
      <section id="system" className="pt-28 sm:pt-36">
        <Container>
          <SectionHead index="03" label="How it works" title="From a click in a browser to a number on your dashboard." />
          <Reveal className="mt-14" delay={80}>
            <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#19191b]">
              <div className="relative h-48 border-b border-white/[0.08] bg-[#0f0f10] sm:h-60">
                <GlyphField variant="stream" interactive />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-6 pb-4 font-mono text-xs text-zinc-500 sm:px-8">
                  <span>events leave the browser</span>
                  <span>and land on your dashboard</span>
                </div>
              </div>
              <ol className="grid sm:grid-cols-2 lg:grid-cols-4">
                {PIPELINE.map(({ icon: Icon, title, detail, spec }, i) => (
                  <li key={title} className="border-white/[0.08] [&:not(:first-child)]:border-t lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:border-t-0 sm:[&:nth-child(even)]:border-l sm:[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0">
                    <Spot className="h-full">
                      <div className="flex h-full flex-col p-6 sm:p-7">
                        <div className="flex items-center justify-between">
                          <span className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.08] bg-[#232325] text-zinc-300">
                            <Icon className="h-4 w-4" strokeWidth={1.5} />
                          </span>
                          <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                        </div>
                        <h3 className="mt-6 text-[15px] font-medium text-zinc-50">{title}</h3>
                        <p className="mt-2 flex-1 text-sm leading-[22px] text-zinc-400">{detail}</p>
                        <p className="mt-5 inline-flex w-fit items-center rounded-md border border-white/[0.08] px-2 py-1 font-mono text-xs text-zinc-400">{spec}</p>
                      </div>
                    </Spot>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* --------------------------------------------------------- Privacy */}
      <section id="privacy" className="pt-28 sm:pt-36">
        <Container>
          <SectionHead index="04" label="Privacy" title="Counts visits without keeping what could identify a person." lead="Most of the privacy work happens at the edge, where the IP address is read once and dropped." />
          <Reveal className="mt-14" delay={80}>
            <PrivacyLedger />
          </Reveal>
          {links.privacy && (
            <SmartLink href={links.privacy} className="mt-6 inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-100">
              Read the privacy overview <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
            </SmartLink>
          )}
        </Container>
      </section>

      {/* ----------------------------------------------------------- Setup */}
      <section id="install" className="pt-28 sm:pt-36">
        <Container>
          <SectionHead index="05" label="Setup" title="One tag, and your first pageview in minutes." />
          <div className="mt-14 grid items-start gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <Reveal delay={80}>
              <ol className="relative">
                {[
                  ["Create a workspace and add your site", "You get a public site key. It can only write events, never read them."],
                  ["Add the tag to your head", "It loads deferred, follows single-page navigation by itself, and retries when the network drops."],
                  ["Watch the first event arrive", "The dashboard confirms the tag is live, then fills in as traffic comes."],
                ].map(([title, body], i, all) => (
                  <li key={title} className="relative flex gap-4 pb-9 last:pb-0">
                    {i < all.length - 1 && <span className="absolute bottom-0 left-4 top-8 w-px bg-white/[0.1]" />}
                    <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.16] bg-[#141415] font-mono text-[13px] text-zinc-300">{i + 1}</span>
                    <div className="pt-1">
                      <h3 className="text-base font-medium leading-6 text-zinc-50">{title}</h3>
                      <p className="mt-1 text-sm leading-[22px] text-zinc-400">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-8 flex flex-wrap items-center gap-2">
                {["React", "Next.js", "Vue", "Svelte", "Angular"].map((fw) => (
                  <SmartLink key={fw} href={links.frameworks} className="inline-flex h-7 items-center rounded-lg border border-white/[0.08] px-3 text-[13px] text-zinc-400 transition-colors duration-150 hover:border-white/[0.2] hover:text-zinc-100">
                    {fw}
                  </SmartLink>
                ))}
                <SmartLink href={links.quickstart} className="ml-1 inline-flex items-center gap-1 text-[13px] text-zinc-300 transition-colors duration-150 hover:text-white">
                  Quickstart <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
                </SmartLink>
              </div>
            </Reveal>

            <Reveal delay={160}>
              <InstallConsole
                snippet={SNIPPET}
                lines={
                  <code>
                    <span className="text-zinc-500">&lt;</span>
                    <span className="text-zinc-200">script</span>
                    {"\n  "}
                    <span className="text-zinc-200">defer</span>
                    {"\n  "}
                    <span className="text-zinc-200">src</span>=<span className="text-zinc-100">&quot;{scriptUrl}&quot;</span>
                    {"\n  "}
                    <span className="text-zinc-200">data-site</span>=<span className="text-zinc-100">&quot;YOUR_SITE_KEY&quot;</span>
                    {"\n  "}
                    <span className="text-zinc-200">data-endpoint</span>=<span className="text-zinc-100">&quot;{endpoint}&quot;</span>
                    {"\n"}
                    <span className="text-zinc-500">&gt;&lt;/</span>
                    <span className="text-zinc-200">script</span>
                    <span className="text-zinc-500">&gt;</span>
                  </code>
                }
              />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* --------------------------------------------------------- Pricing */}
      {pricing && (
        <section id="pricing" className="scroll-mt-16 pt-28 sm:pt-36">
          <Container>
            <SectionHead
              index="06"
              label="Pricing"
              title={pricing.currentPlan === "pro" ? "You are on Pro. Everything is unlocked." : "Start free. Move to Pro when the team grows."}
              lead="One price for the whole company, shared by every workspace in it. Cancel any time; your data stays."
            />
            <div className="mt-12">
              <Pricing {...pricing} />
            </div>
          </Container>
        </section>
      )}

      {/* ------------------------------------------------------------- FAQ */}
      <section id="faq" className="pt-28 sm:pt-36">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[420px_1fr] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHead index={pricing ? "07" : "06"} label="Questions" title="Good to know before you start." />
              <SmartLink href={links.docs} className="mt-8 inline-flex items-center gap-1 text-sm text-zinc-300 transition-colors duration-150 hover:text-white">
                Read the docs <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
              </SmartLink>
            </div>
            <Reveal delay={80}>
              <div className="border-t border-white/[0.1]">
                {FAQS.map(({ q, a }, i) => (
                  <details key={q} className="faq-item border-b border-white/[0.1] transition-colors duration-200">
                    <summary className="flex cursor-pointer list-none items-center gap-5 px-2 py-6 text-[17px] font-medium text-zinc-100">
                      <span className="w-6 font-mono text-xs font-normal text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                      <span className="flex-1">{q}</span>
                      <span className="faq-plus grid h-7 w-7 place-items-center rounded-full border border-white/[0.14] font-mono text-base text-zinc-400 transition-transform duration-300">+</span>
                    </summary>
                    <p className="max-w-2xl pb-7 pl-[68px] pr-8 text-[15px] leading-6 text-zinc-400">{a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ------------------------------------------------------------- CTA */}
      <section className="pt-28 sm:pt-36">
        <Container>
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.12]" style={{ backgroundColor: INK }}>
            {/* The traffic picture runs along the bottom edge, lit by the cursor */}
            <div className="absolute inset-x-0 bottom-0 h-[260px] [mask-image:linear-gradient(to_bottom,transparent,black_45%)]">
              <GlyphField variant="ridge" strength={0.9} interactive />
            </div>
            <div className="relative z-10 grid items-end gap-10 px-6 pb-56 pt-14 sm:px-12 sm:pt-20 lg:grid-cols-[1fr_1fr] lg:gap-14">
              <div>
                <p className="font-mono text-xs text-zinc-500">{pricing ? "08" : "07"} — Start</p>
                <h2 className="mt-5 text-balance text-[36px] font-medium leading-[42px] tracking-[-0.03em] text-zinc-50 sm:text-[52px] sm:leading-[56px]">
                  Your first pageview is one tag away.
                </h2>
                <div className="mt-8 flex flex-wrap gap-3">
                  <SmartLink href={primaryHref} className={primaryButton}>
                    {primaryLabel} <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.5} />
                  </SmartLink>
                  <SmartLink href={links.docs} className={secondaryButton}>
                    Read the docs
                  </SmartLink>
                </div>
              </div>
              <CopySnippet
                label="index.html"
                text={SNIPPET}
                lines={
                  <code>
                    <span className="text-zinc-500">&lt;</span>
                    <span className="text-zinc-200">script</span> <span className="text-zinc-200">defer</span> <span className="text-zinc-200">src</span>=<span className="text-zinc-100">&quot;…/t/v1/tracker.js&quot;</span>
                    {"\n  "}
                    <span className="text-zinc-200">data-site</span>=<span className="text-zinc-100">&quot;YOUR_SITE_KEY&quot;</span>
                    {"\n  "}
                    <span className="text-zinc-200">data-endpoint</span>=<span className="text-zinc-100">&quot;…/v1/batch&quot;</span>
                    <span className="text-zinc-500">&gt;&lt;/</span>
                    <span className="text-zinc-200">script</span>
                    <span className="text-zinc-500">&gt;</span>
                  </code>
                }
              />
            </div>
          </div>
        </Container>
      </section>

      {/* ---------------------------------------------------------- Footer */}
      <footer className="relative mt-28 overflow-hidden border-t border-white/[0.1] sm:mt-36" style={{ backgroundColor: INK }}>
        <Container className="relative z-10 pt-16">
          <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div className="max-w-sm">
              <SmartLink href="#product" className="inline-flex items-center gap-2 text-lg font-medium leading-none text-zinc-50" aria-label={`${product} home`}>
                <Mark />
                {product}
              </SmartLink>
              <p className="mt-4 text-sm leading-[22px] text-zinc-400">Cookieless analytics for marketing, engineering and product teams, running on your own infrastructure.</p>
              <p className="mt-6 inline-flex items-center gap-2 text-[13px] text-zinc-500">
                <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
                No tracking cookies. No stored IP addresses.
              </p>
            </div>

            <FooterColumn title="Product">
              <FooterLink href="#features">What you see</FooterLink>
              <FooterLink href="#ask">What it cost</FooterLink>
              <FooterLink href="#system">How it works</FooterLink>
              <FooterLink href="#privacy">Privacy</FooterLink>
              <FooterLink href="#faq">FAQ</FooterLink>
            </FooterColumn>

            <FooterColumn title="Developers">
              <FooterLink href={links.docs}>Documentation</FooterLink>
              <FooterLink href={links.quickstart}>Quickstart</FooterLink>
              <FooterLink href={links.frameworks}>Frameworks</FooterLink>
              {links.reference && <FooterLink href={links.reference}>Reference</FooterLink>}
              {links.selfHosting && <FooterLink href={links.selfHosting}>Self-hosting</FooterLink>}
            </FooterColumn>

            <FooterColumn title="Account">
              {viewer ? (
                <FooterLink href={viewer.href}>{viewer.cta ?? "Go to workspace"}</FooterLink>
              ) : (
                <>
                  {links.signIn && <FooterLink href={links.signIn}>Sign in</FooterLink>}
                  <FooterLink href={links.getStarted}>Create workspace</FooterLink>
                </>
              )}
              {links.privacy && <FooterLink href={links.privacy}>Privacy overview</FooterLink>}
            </FooterColumn>
          </div>
        </Container>

        {/* The name, set in the page's own glyphs. It lights up under the cursor. */}
        <div className="relative mt-14 h-[200px] sm:h-[300px] lg:h-[360px]" aria-hidden="true">
          <GlyphField variant="text" text={product} cell={10} interactive />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0f0f10] to-transparent" />
        </div>

        <div className="relative z-10 border-t border-white/[0.08] bg-[#0f0f10]">
          <Container className="flex flex-col gap-3 py-5 text-[13px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {product} · {RELEASE.label}</p>
            <p className="font-mono text-xs">Go edge · Kafka · ClickHouse</p>
            <a href="#product" className="inline-flex items-center gap-1 text-zinc-400 transition-colors duration-150 hover:text-zinc-100">
              Back to top <ArrowUpRight className="h-4 w-4 -rotate-45" strokeWidth={1.5} />
            </a>
          </Container>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
      <ul className="mt-4 space-y-3">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <SmartLink href={href} className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-100">
        {children}
      </SmartLink>
    </li>
  );
}
