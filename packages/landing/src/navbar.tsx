"use client";

import * as React from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  Filter,
  Gauge,
  MapPinned,
  Menu,
  Radio,
  Target,
  TrendingUp,
  UserCheck,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { SmartLink } from "./smart-link";
import { openDemoView, type DemoViewId } from "./demo-bus";
import type { LandingViewer } from "./landing";

export interface NavLinks {
  docs: string;
  signIn?: string | undefined;
  getStarted: string;
}

const PRODUCT: { view: DemoViewId; icon: LucideIcon; title: string; line: string }[] = [
  { view: "realtime", icon: Radio, title: "Realtime", line: "Who is on the site right now" },
  { view: "journeys", icon: Waypoints, title: "User journeys", line: "The routes people take" },
  { view: "funnels", icon: Filter, title: "Funnels", line: "Where visitors leave" },
  { view: "acquisition", icon: TrendingUp, title: "Acquisition", line: "Sources, credited per visit" },
  { view: "geography", icon: MapPinned, title: "Audience", line: "A globe of your visitors" },
  { view: "vitals", icon: Gauge, title: "Web Vitals", line: "Performance, as felt" },
  { view: "people", icon: UserCheck, title: "User profiles", line: "One person, in order" },
  { view: "events", icon: Target, title: "Goals & events", line: "What visitors do" },
];

const SPECS: [string, string][] = [
  ["Tag", "< 10 KB gzipped"],
  ["Cookies", "0"],
  ["IP address", "dropped at the edge"],
  ["Visitor ID", "rotates every 24 h"],
  ["Session", "ends after 30 min idle"],
  ["Per request", "up to 50 events"],
];

const SECTIONS = [
  { id: "system", label: "System" },
  { id: "privacy", label: "Privacy" },
  { id: "install", label: "Setup" },
  { id: "faq", label: "FAQ" },
];

export function Navbar({ product, links, viewer }: { product: string; links: NavLinks; viewer?: LandingViewer | undefined }) {
  const [scrolled, setScrolled] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [menu, setMenu] = React.useState(false);
  const [mobile, setMobile] = React.useState(false);
  const [active, setActive] = React.useState<string | null>(null);
  const closeTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [menu]);

  const open = () => {
    window.clearTimeout(closeTimer.current);
    setMenu(true);
  };
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMenu(false), 160);
  };

  const linkClass = (on: boolean) =>
    `relative rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${on ? "bg-white/[0.07] text-zinc-50" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"}`;

  return (
    <div className="sticky top-0 z-40 h-0" onPointerLeave={closeSoon} onPointerEnter={() => window.clearTimeout(closeTimer.current)}>
     <div className="absolute inset-x-0 top-0 px-4 pt-4">
      <div className={`relative mx-auto transition-[max-width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${scrolled ? "max-w-[940px]" : "max-w-[1136px]"}`}>
        {/* The pill sits above everything that slides out from behind it. */}
        <header
          className={`relative z-20 flex items-center gap-6 rounded-2xl border border-white/[0.1] px-4 transition-[height,background-color,box-shadow] duration-300 sm:px-5 ${
            scrolled ? "h-14 bg-[#141415]/80 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.8)] backdrop-blur-xl" : "h-16 bg-[#141415]"
          }`}
        >
          <SmartLink href="#product" className="flex items-center gap-2 text-lg font-medium leading-none text-zinc-50" aria-label={`${product} home`}>
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#ededed] text-[#141415]">
              <Activity className="h-4 w-4" strokeWidth={1.75} />
            </span>
            {product}
          </SmartLink>

          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onPointerEnter={open}
              onFocus={open}
              onClick={() => setMenu((m) => !m)}
              aria-expanded={menu}
              aria-haspopup="true"
              className={`${linkClass(menu)} flex items-center gap-1`}
            >
              Product
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${menu ? "rotate-180" : ""}`} strokeWidth={1.5} />
            </button>
            {SECTIONS.slice(0, 3).map((s) => (
              <a key={s.id} href={`#${s.id}`} className={linkClass(active === s.id)}>
                {s.label}
              </a>
            ))}
            <SmartLink href={links.docs} className={linkClass(false)}>
              Docs
            </SmartLink>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {viewer ? (
              <SmartLink
                href={viewer.href}
                className="hidden max-w-[180px] truncate text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-100 sm:inline"
              >
                Welcome, {viewer.name}
              </SmartLink>
            ) : (
              links.signIn && (
                <SmartLink href={links.signIn} className="hidden text-sm text-zinc-400 transition-colors duration-150 hover:text-zinc-100 sm:inline">
                  Sign in
                </SmartLink>
              )
            )}
            <SmartLink
              href={viewer?.href ?? links.getStarted}
              className="inline-flex h-9 items-center rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors duration-150 hover:bg-white"
            >
              {viewer ? (viewer.cta ?? "Go to workspace") : "Get started"}
            </SmartLink>
            <button
              type="button"
              onClick={() => setMobile((m) => !m)}
              aria-label={mobile ? "Close menu" : "Open menu"}
              aria-expanded={mobile}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.1] text-zinc-300 md:hidden"
            >
              {mobile ? <X className="h-4 w-4" strokeWidth={1.5} /> : <Menu className="h-4 w-4" strokeWidth={1.5} />}
            </button>
          </div>

          {/* Reading progress, drawn on the bar's bottom edge */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-0 h-px overflow-hidden">
            <span className="block h-px origin-left bg-zinc-300/70" style={{ transform: `scaleX(${progress})` }} />
          </span>
        </header>

        {/* The menu slides out from behind the bar */}
        <div
          onPointerEnter={open}
          className={`absolute inset-x-0 top-full z-10 -mt-4 hidden pt-6 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:block ${
            menu ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"
          }`}
        >
          <div className="grid grid-cols-[1.7fr_1fr] gap-2 rounded-2xl border border-white/[0.1] bg-[#141415] p-2 shadow-[0_32px_64px_-24px_rgba(0,0,0,0.9)]">
            <ul className="grid grid-cols-2 gap-1 p-1">
              {PRODUCT.map(({ view, icon: Icon, title, line }) => (
                <li key={view}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      openDemoView(view);
                    }}
                    className="group flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors duration-150 hover:bg-white/[0.05]"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#232325] text-zinc-300 transition-colors group-hover:text-zinc-50">
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-sm font-medium text-zinc-100">
                        {title}
                        <ArrowUpRight className="h-3.5 w-3.5 text-zinc-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100" strokeWidth={1.5} />
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-[18px] text-zinc-500">{line}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-[#0f0f10] p-5">
              <p className="text-xs text-zinc-500">Spec sheet</p>
              <dl className="mt-4 space-y-3 font-mono text-[13px]">
                {SPECS.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="text-right text-zinc-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        {mobile && (
          <div className="relative z-10 mt-2 rounded-2xl border border-white/[0.1] bg-[#141415] p-2 md:hidden">
            {[{ id: "features", label: "Product" }, ...SECTIONS].map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={() => setMobile(false)} className="block rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.05]">
                {s.label}
              </a>
            ))}
            <SmartLink href={links.docs} className="block rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.05]">
              Docs
            </SmartLink>
          </div>
        )}
      </div>
     </div>
    </div>
  );
}
