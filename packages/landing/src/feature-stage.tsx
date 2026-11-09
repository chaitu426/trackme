"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Bug,
  CreditCard,
  Filter,
  Gauge,
  MapPinned,
  Radio,
  Repeat2,
  Rocket,
  Target,
  TrendingUp,
  UserCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { GlyphField, type GlyphVariant } from "./glyph-field";
import { openDemoView, type DemoViewId } from "./demo-bus";

interface Feature {
  id: string;
  label: string;
  icon: LucideIcon;
  variant: GlyphVariant;
  /** The demo view this opens. Features without a demo view show no button. */
  view?: DemoViewId;
  title: string;
  body: string;
  readout: [string, string][];
  /** Rows that rotate through, like a live feed, instead of a fixed list. */
  live?: boolean;
}

const FEATURES: Feature[] = [
  {
    id: "realtime",
    label: "Realtime",
    icon: Radio,
    variant: "pulse",
    view: "realtime",
    title: "Watch visits arrive",
    body: "Who is online right now and the latest events, straight from your edge.",
    live: true,
    readout: [
      ["now", "pageview  /pricing"],
      ["2s", "goal  account_created"],
      ["5s", "pageview  /docs/quickstart"],
      ["8s", "custom  copy_snippet"],
      ["11s", "pageview  /changelog"],
      ["14s", "pageview  /signup"],
    ],
  },
  {
    id: "journeys",
    label: "User journeys",
    icon: Waypoints,
    variant: "stream",
    view: "journeys",
    title: "Follow the routes people take",
    body: "From entry page to last step, with the common paths and where they end.",
    readout: [
      ["/ → /pricing → /signup", "1,840"],
      ["/blog → /docs → /signup", "1,260"],
      ["/ → /docs → /frameworks", "980"],
      ["/ → /changelog", "410"],
    ],
  },
  {
    id: "funnels",
    label: "Funnels",
    icon: Filter,
    variant: "steps",
    view: "funnels",
    title: "Find the step where visitors leave",
    body: "Page visits and custom events as steps, with the count and share at each one.",
    readout: [
      ["Landing page", "12,480 · 100%"],
      ["Pricing", "4,912 · 39.4%"],
      ["Sign-up", "1,206 · 9.7%"],
      ["Workspace created", "874 · 7.0%"],
    ],
  },
  {
    id: "acquisition",
    label: "Acquisition",
    icon: TrendingUp,
    variant: "ridge",
    view: "acquisition",
    title: "Credit the visit, not the page",
    body: "The first outside referrer decides the source, so moving around your site never counts.",
    readout: [
      ["Google", "34%"],
      ["Direct", "27%"],
      ["GitHub", "14%"],
      ["Hacker News", "9%"],
    ],
  },
  {
    id: "geography",
    label: "Audience",
    icon: MapPinned,
    variant: "globe",
    view: "geography",
    title: "See where they are",
    body: "The country comes from the IP address, which is then discarded.",
    readout: [
      ["United States", "29%"],
      ["Germany", "12%"],
      ["United Kingdom", "10%"],
      ["India", "9%"],
    ],
  },
  {
    id: "vitals",
    label: "Web Vitals",
    icon: Gauge,
    variant: "gauge",
    view: "vitals",
    title: "Performance, as visitors felt it",
    body: "Real browsers, Google’s thresholds, rated good, needs improvement or poor.",
    readout: [
      ["LCP", "1.9 s · Good"],
      ["INP", "96 ms · Good"],
      ["CLS", "0.04 · Good"],
      ["TTFB", "412 ms · Good"],
    ],
  },
  {
    id: "people",
    label: "User profiles",
    icon: UserCheck,
    variant: "stream",
    view: "people",
    title: "One person, in order",
    body: "Identify a signed-in user and read their visit as a timeline.",
    readout: [
      ["10:42", "pageview  /pricing"],
      ["10:43", "plan_toggled  annual"],
      ["10:44", "pageview  /signup"],
      ["10:46", "goal  account_created"],
    ],
  },
  {
    id: "events",
    label: "Goals & events",
    icon: Target,
    variant: "pulse",
    view: "events",
    title: "Know what they do",
    body: "Clicks, downloads and scroll depth with no setup. Your own events when you need them.",
    readout: [
      ["scroll_depth", "9,410"],
      ["copy_snippet", "2,644"],
      ["outbound_click", "1,932"],
      ["account_created", "874"],
    ],
  },
  {
    id: "errors",
    label: "Error tracking",
    icon: Bug,
    variant: "pulse",
    title: "Fix what breaks, first",
    body: "Errors grouped by cause, with the release that introduced them and the stack mapped back to your source.",
    readout: [
      ["Cannot read 'items'", "412 · web@1.2.0"],
      ["GET /api/cart 500", "96 · new"],
      ["Request timed out", "18"],
      ["analytics is not defined", "resolved"],
    ],
  },
  {
    id: "releases",
    label: "Release impact",
    icon: Rocket,
    variant: "ridge",
    title: "See what a deploy did",
    body: "Errors, conversion and load time before and after a release. A verdict only appears when there is enough traffic to trust it.",
    readout: [
      ["web@1.2.0", "Regressed"],
      ["Sessions with an error", "+535%"],
      ["Safari", "1.1% → 32%"],
      ["Rollback", "suggested"],
    ],
  },
  {
    id: "retention",
    label: "Retention",
    icon: Repeat2,
    variant: "steps",
    title: "Who comes back",
    body: "Weekly cohorts of the people you identified, and how many return, for any event you choose.",
    readout: [
      ["Week 0", "100%"],
      ["Week 1", "46%"],
      ["Week 2", "34%"],
      ["Week 4", "27%"],
    ],
  },
  {
    id: "payments",
    label: "Payments",
    icon: CreditCard,
    variant: "gauge",
    title: "Know why a payment failed",
    body: "Razorpay and Stripe webhooks: revenue, success rate by method, gateway incidents and the failure codes behind them. Never card numbers.",
    readout: [
      ["Success rate", "90.9%"],
      ["card · 3DS failed", "41"],
      ["upi · collect expired", "27"],
      ["Gateway timeout", "26"],
    ],
  },
];

const INTERVAL = 6500;

export function FeatureStage() {
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const [auto, setAuto] = React.useState(true);

  React.useEffect(() => {
    if (paused || !auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % FEATURES.length), INTERVAL);
    return () => window.clearTimeout(t);
  }, [index, paused, auto]);

  // The live feed turns over every couple of seconds.
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1800);
    return () => window.clearInterval(t);
  }, []);

  const f = FEATURES[index]!;
  const rows = f.live ? Array.from({ length: 4 }, (_, i) => f.readout[(tick + i) % f.readout.length]!) : f.readout;

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div role="tablist" aria-label="What TrackMe measures" aria-orientation="vertical" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {FEATURES.map((item, i) => {
          const Icon = item.icon;
          const on = i === index;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setIndex(i);
                setAuto(false);
              }}
              className={`relative flex h-12 shrink-0 items-center gap-3 overflow-hidden rounded-xl px-4 text-left text-[15px] transition-colors duration-150 ${
                on ? "bg-[#232325] text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              }`}
            >
              <span className="w-5 font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
              <Icon className={`h-4 w-4 shrink-0 ${on ? "text-zinc-100" : "text-zinc-500"}`} strokeWidth={1.5} />
              <span className="whitespace-nowrap">{item.label}</span>
              {on && auto && !paused && (
                <span key={`${index}-bar`} aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px origin-left bg-zinc-200/60" style={{ animation: `stageBar ${INTERVAL}ms linear forwards` }} />
              )}
            </button>
          );
        })}
      </div>

      <div className="relative min-h-[480px] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0f0f10]">
        <div key={f.id} className="absolute inset-0" style={{ animation: "stageIn 0.7s cubic-bezier(0.22,1,0.36,1) both" }}>
          <GlyphField variant={f.variant} strength={0.95} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#0f0f10_0%,#0f0f10_42%,rgba(15,15,16,0.55)_62%,rgba(15,15,16,0)_85%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,#0f0f10_0%,rgba(15,15,16,0)_40%)]" />

        <div key={`${f.id}-copy`} className="relative z-10 flex h-full min-h-[480px] flex-col justify-between p-6 sm:p-8" style={{ animation: "stageIn 0.5s cubic-bezier(0.22,1,0.36,1) both" }}>
          <div className="max-w-sm">
            <p className="font-mono text-xs text-zinc-500">
              {String(index + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}
            </p>
            <h3 className="mt-3 text-balance text-[28px] font-medium leading-9 tracking-[-0.02em] text-zinc-50">{f.title}</h3>
            <p className="mt-3 text-[15px] leading-6 text-zinc-400">{f.body}</p>
            {f.view && (
              <button
                type="button"
                onClick={() => openDemoView(f.view!)}
                className="mt-5 inline-flex h-9 items-center gap-1 rounded-lg border border-white/[0.12] bg-[#19191b]/80 px-3 text-sm text-zinc-100 transition-colors duration-150 hover:border-white/[0.25]"
              >
                Open in the demo <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>

          <div className="mt-8 w-full max-w-sm rounded-xl border border-white/[0.1] bg-[#141415]/90 p-4 font-mono text-[13px] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.8)]">
            {rows.map(([k, v], i) => (
              <div key={`${tick}-${i}-${k}`} className="flex items-baseline justify-between gap-6 border-b border-white/[0.06] py-2 first:pt-0 last:border-0 last:pb-0" style={f.live ? { animation: "stageIn 0.4s cubic-bezier(0.22,1,0.36,1) both" } : undefined}>
                <span className="truncate text-zinc-500">{k}</span>
                <span className="shrink-0 text-right text-zinc-100">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
