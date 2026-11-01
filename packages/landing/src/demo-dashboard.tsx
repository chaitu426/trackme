"use client";

import * as React from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart2,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  Gauge,
  Globe,
  Globe2,
  MapPinned,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings2,
  Smartphone,
  Tablet,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { GlyphField, type GlyphVariant } from "./glyph-field";
import { DEMO_EVENT, type DemoAction, type DemoViewId } from "./demo-bus";
import {
  COUNTRIES,
  DEVICES,
  JOURNEYS,
  RANGES,
  RANGE_COMPARE,
  SERIES,
  SOURCES,
  TOP_PAGES,
  change,
  fmtChange,
  fmtDuration,
  fmtNumber,
  fmtPercent,
  kpis,
  type RangeKey,
  type Share,
} from "./demo-data";

/* The demo copies the real dashboard's Overview: same shell, same cards, same filters.
   Every other view is a short, honest preview with a way into a real workspace. */

const ACCENT = "#ededed";
const UP = "#4cc38a";
const DOWN = "#e5484d";

type NavItem = { id: DemoViewId; label: string; icon: LucideIcon; live?: boolean };

const ANALYTICS: NavItem[] = [
  { id: "overview", label: "Overview", icon: BarChart2 },
  { id: "realtime", label: "Realtime", icon: Radio, live: true },
  { id: "people", label: "User Profiles", icon: UserCheck },
  { id: "journeys", label: "User Journeys", icon: Waypoints },
  { id: "funnels", label: "Funnels", icon: Filter },
  { id: "acquisition", label: "Acquisition", icon: TrendingUp },
  { id: "geography", label: "Audience Geography", icon: MapPinned },
  { id: "events", label: "Goals & Events", icon: Target },
  { id: "vitals", label: "Web Vitals", icon: Gauge },
  { id: "pages", label: "Page Performance", icon: FileText },
];

const WORKSPACE: NavItem[] = [
  { id: "org", label: "Organization & Team", icon: Users },
  { id: "sites", label: "Websites (1)", icon: Globe },
  { id: "settings", label: "Site Settings", icon: Settings2 },
];

const PREVIEWS: Record<Exclude<DemoViewId, "overview">, { title: string; headline: string; body: string; points: string[]; art: GlyphVariant }> = {
  realtime: {
    title: "Realtime",
    headline: "See visitors as they arrive",
    body: "A live count of who is on the site and the pages they are viewing, updated from the events reaching your edge.",
    points: ["Online now, over the last five minutes", "The latest events as a stream", "Pageviews, custom events and goals together"],
    art: "pulse",
  },
  people: {
    title: "User Profiles",
    headline: "Follow one person’s visit, in order",
    body: "Identify a signed-in user with your own ID and see their sessions and events as a timeline. Save the segments you come back to.",
    points: ["Sessions and events per person", "Traits from your own identify call", "Saved segments"],
    art: "stream",
  },
  journeys: {
    title: "User Journeys",
    headline: "See the routes people actually take",
    body: "From entry page to last step, with the common paths, where they fork and where visitors leave the site.",
    points: ["Top routes and their share", "Entry and exit pages", "Drop-off between pages"],
    art: "stream",
  },
  funnels: {
    title: "Funnels",
    headline: "Find the step where visitors leave",
    body: "Build a funnel from page visits and custom events and see how many visitors reach each step. Start from a sign-up or checkout template.",
    points: ["Steps from page visits or custom events", "Count and share at every step", "Ready-made templates"],
    art: "steps",
  },
  acquisition: {
    title: "Acquisition",
    headline: "Know which sources bring visitors who stay",
    body: "Sources and campaigns are credited to the visit, not to each page, so moving around your own site never counts as a source.",
    points: ["Channels and referrers", "UTM campaign tags", "Compared with the previous period"],
    art: "ridge",
  },
  geography: {
    title: "Audience Geography",
    headline: "See where your visitors are",
    body: "An interactive globe and a ranked list of countries. The country comes from the IP address, which is then discarded.",
    points: ["Interactive globe", "Ranked countries", "Filters that carry across every report"],
    art: "globe",
  },
  events: {
    title: "Goals & Events",
    headline: "Measure what visitors do, not just where",
    body: "Outbound clicks, file downloads and scroll depth are recorded with no setup. Add custom events and goals when you need them.",
    points: ["Recorded automatically", "Your own custom events", "Conversion goals"],
    art: "pulse",
  },
  vitals: {
    title: "Web Vitals",
    headline: "Performance as your visitors felt it",
    body: "LCP, INP, CLS, FCP and TTFB from real browsers, rated good, needs improvement or poor with Google’s thresholds.",
    points: ["Real visitors, not a lab test", "Per page and per device", "p75 summaries"],
    art: "gauge",
  },
  pages: {
    title: "Page Performance",
    headline: "Which pages carry your traffic",
    body: "Views, entries and time on page for every route, so you can see what is worth improving first.",
    points: ["Views and unique visitors", "Entry and exit pages", "Active time per page"],
    art: "ridge",
  },
  org: {
    title: "Organization & Team",
    headline: "Invite your team, set their access",
    body: "Roles for owners, admins and members, invitations by email, and a single place to manage the workspace.",
    points: ["Roles and invitations", "Transfer ownership", "Audit log"],
    art: "pulse",
  },
  sites: {
    title: "Websites",
    headline: "One workspace, every site",
    body: "Add a domain, copy its tag and watch the first event arrive. Each site has its own key, settings and privacy controls.",
    points: ["Public write-only site keys", "Per-site privacy settings", "Domain allow-listing"],
    art: "stream",
  },
  settings: {
    title: "Site Settings",
    headline: "Snippet, privacy and API keys",
    body: "Everything about how a site collects data: the tag, Do Not Track, consent gating, signing and API keys.",
    points: ["Install snippet", "Consent and Do Not Track", "API keys and audit trail"],
    art: "gauge",
  },
};

const BREADCRUMB: Record<DemoViewId, string> = {
  overview: "Overview",
  realtime: "Realtime",
  people: "User Profiles",
  journeys: "User Journeys",
  funnels: "Funnels",
  acquisition: "Acquisition",
  geography: "Audience Geography",
  events: "Goals & Events",
  vitals: "Web Vitals",
  pages: "Page Performance",
  org: "Organization & Team",
  sites: "Websites",
  settings: "Site Settings",
};

/* ------------------------------------------------------------------ parts */

const cardClass = "rounded-xl border border-white/[0.08] bg-[#19191b]";

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`${cardClass} ${className}`}>{children}</div>;
}

function CardHead({ title, note, right }: { title: string; note?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 pb-4">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        {note && <p className="mt-1 text-xs leading-4 text-zinc-400">{note}</p>}
      </div>
      {right}
    </div>
  );
}

function Stat({ label, value, delta, compare, goodWhenDown }: { label: string; value: string; delta: number; compare: string; goodWhenDown?: boolean }) {
  const good = goodWhenDown ? delta <= 0 : delta >= 0;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <span className="text-sm text-zinc-400">{label}</span>
      <p className="text-[28px] font-medium leading-8 tabular-nums text-zinc-50">{value}</p>
      <p className="text-xs leading-4 text-zinc-500">
        <span className="font-mono tabular-nums" style={{ color: good ? UP : DOWN }}>
          {fmtChange(delta)}
        </span>{" "}
        {compare}
      </p>
    </Card>
  );
}

function RankingList({ items, total, format = fmtNumber }: { items: Share[]; total: number; format?: (n: number) => string }) {
  const max = Math.max(...items.map((i) => i.share), 0.0001);
  return (
    <ul className="space-y-0.5">
      {items.map((item, rank) => (
        <li key={item.name} className="relative flex items-center overflow-hidden rounded-md px-3 py-2 transition-colors hover:bg-white/[0.04]">
          <span
            className="pointer-events-none absolute inset-y-0 left-0 rounded-md"
            style={{ width: `${Math.max((item.share / max) * 100, 1.5)}%`, background: "linear-gradient(90deg, rgba(237,237,237,0.10) 0%, rgba(237,237,237,0.04) 100%)" }}
          />
          <div className="relative z-10 flex w-full items-center gap-3">
            <span className="w-4 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600">{rank + 1}</span>
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-zinc-200">{item.name}</p>
            <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-300">{format(Math.round(total * item.share))}</span>
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600">{Math.round(item.share * 100)}%</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Pills<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex h-8 items-center gap-0.5 rounded-lg border border-white/[0.08] p-0.5 text-xs text-zinc-400">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={option === value}
          onClick={() => onChange(option)}
          className={`inline-flex h-full items-center rounded-md px-3 transition-colors duration-150 ${
            option === value ? "bg-[#232325] font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Dropdown({
  label,
  icon,
  value,
  options,
  onSelect,
  allLabel,
}: {
  label: string;
  icon: React.ReactNode;
  value: string | null;
  options: { name: string; hint?: string }[];
  onSelect: (name: string | null) => void;
  allLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const rows: { name: string | null; text: string; hint?: string | undefined }[] = [
    { name: null, text: allLabel },
    ...options.map((o) => ({ name: o.name, text: o.name, hint: o.hint })),
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 items-center gap-2 rounded-lg border px-3 text-xs transition-colors ${
          value ? "border-white/[0.25] bg-white/[0.07] text-zinc-100" : "border-white/[0.08] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-100"
        }`}
      >
        {icon}
        <span className="max-w-[120px] truncate">{value ?? label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.5} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-40 mt-2 w-56 rounded-xl border border-white/[0.08] bg-[#19191b] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]">
          {rows.map((o) => (
            <button
              key={o.text}
              type="button"
              role="option"
              aria-selected={o.name === value}
              onClick={() => {
                onSelect(o.name);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                o.name === value ? "bg-white/[0.08] font-medium text-zinc-100" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
            >
              <span className="truncate">{o.text}</span>
              <span className="flex items-center gap-2">
                {o.hint && <span className="font-mono text-xs text-zinc-600">{o.hint}</span>}
                {o.name === value && <Check className="h-4 w-4 text-zinc-200" strokeWidth={1.5} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ chart */

type Point = { label: string; visitors: number; sessions: number };

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState(760);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function TrafficChart({ points }: { points: Point[] }) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const width = useWidth(wrap);
  const [hover, setHover] = React.useState<number | null>(null);
  const height = 320;
  const pad = { t: 16, r: 24, b: 36, l: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const rawMax = Math.max(...points.map((p) => Math.max(p.visitors, p.sessions)), 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax / 4)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s * 4 >= rawMax) ?? mag * 10;
  const max = step * 4;
  const x = (i: number) => pad.l + (i / Math.max(points.length - 1, 1)) * innerW;
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;

  const smooth = (values: number[]) => {
    const pts = values.map((v, i) => [x(i), y(v)] as const);
    let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const p = pts[i - 1] ?? a;
      const n = pts[i + 2] ?? b;
      d += ` C${(a[0] + (b[0] - p[0]) * 0.3).toFixed(1)} ${(a[1] + (b[1] - p[1]) * 0.3).toFixed(1)},${(b[0] - (n[0] - a[0]) * 0.3).toFixed(1)} ${(b[1] - (n[1] - a[1]) * 0.3).toFixed(1)},${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    return d;
  };
  const vLine = smooth(points.map((p) => p.visitors));
  const area = `${vLine} L${x(points.length - 1).toFixed(1)} ${pad.t + innerH} L${x(0).toFixed(1)} ${pad.t + innerH} Z`;
  const every = Math.ceil(points.length / 7);
  const active = hover === null ? null : points[hover];

  return (
    <div ref={wrap} className="select-none">
      <div className="flex h-8 items-center justify-between px-5 pb-2 text-xs">
        <div className="flex items-center gap-4 text-zinc-400">
          <span className="flex items-center gap-2">
            <i className="h-2 w-2 rounded-full" style={{ background: ACCENT }} />
            Visitors
          </span>
          <span className="flex items-center gap-2">
            <i className="h-2 w-2 rounded-full bg-[#8b8b92]" />
            Sessions
          </span>
        </div>
        {active && (
          <div className="flex items-center gap-4 font-mono tabular-nums text-zinc-200">
            <span className="text-zinc-500">{active.label}</span>
            <span className="flex items-center gap-2">
              <i className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              {fmtNumber(active.visitors)}
            </span>
            <span className="flex items-center gap-2">
              <i className="h-1.5 w-1.5 rounded-full bg-[#8b8b92]" />
              {fmtNumber(active.sessions)}
            </span>
          </div>
        )}
      </div>
      <svg
        width={width}
        height={height}
        className="block touch-pan-y overflow-visible"
        role="img"
        aria-label="Visitors and sessions over time"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - rect.left - pad.l) / innerW) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="demo-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={ACCENT} stopOpacity="0.16" />
            <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t * step)} y2={y(t * step)} stroke="rgba(237,237,237,0.06)" />
            <text x={pad.l - 10} y={y(t * step) + 4} textAnchor="end" fill="#85858b" fontSize="12" fontFamily="var(--font-mono), monospace">
              {t * step >= 1000 ? `${(t * step) / 1000}k` : t * step}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#demo-area)" />
        <path d={smooth(points.map((p) => p.sessions))} fill="none" stroke="#8b8b92" strokeWidth="1.5" opacity="0.7" strokeLinecap="round" />
        <path d={vLine} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={p.label} x={x(i)} y={height - 12} textAnchor="middle" fill="#85858b" fontSize="12" fontFamily="var(--font-mono), monospace">
              {p.label}
            </text>
          ) : null,
        )}
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} stroke="rgba(237,237,237,0.1)" />
        {active && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke="rgba(237,237,237,0.16)" />
            <circle cx={x(hover)} cy={y(active.sessions)} r="4" fill="#19191b" stroke="#8b8b92" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(active.visitors)} r="4.5" fill="#19191b" stroke={ACCENT} strokeWidth="2" />
          </g>
        )}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------- Overview */

const DEVICE_ICON: Record<string, React.ReactNode> = {
  Desktop: <Monitor className="h-4 w-4" strokeWidth={1.5} />,
  Mobile: <Smartphone className="h-4 w-4" strokeWidth={1.5} />,
  Tablet: <Tablet className="h-4 w-4" strokeWidth={1.5} />,
};

interface Filters {
  range: RangeKey;
  setRange: (range: RangeKey) => void;
  country: string | null;
  setCountry: (country: string | null) => void;
  device: string | null;
  setDevice: (device: string | null) => void;
}

function Overview({ onOpen, filters }: { onOpen: (view: DemoViewId) => void; filters: Filters }) {
  const { range, setRange, country, setCountry, device, setDevice } = filters;
  const [tab, setTab] = React.useState<"Device" | "Browser" | "OS">("Device");

  // Filters narrow every number by the share of that country and device.
  const factor =
    (country ? (COUNTRIES.find((c) => c.name === country)?.share ?? 1) : 1) *
    (device ? (DEVICES.Device!.find((d) => d.name === device)?.share ?? 1) : 1);
  const compare = RANGE_COMPARE[range];
  const base = kpis(range);
  const k = {
    visitors: base.visitors * factor,
    sessions: base.sessions * factor,
    pageviews: base.pageviews * factor,
    prev: { visitors: base.prev.visitors * factor, sessions: base.prev.sessions * factor, pageviews: base.prev.pageviews * factor },
  };
  const points: Point[] = SERIES[range].map((p) => ({ label: p.label, visitors: Math.round(p.visitors * factor), sessions: Math.round(p.sessions * factor) }));
  const filtered = country !== null || device !== null;
  const online = Math.max(1, Math.round(38 * factor));
  const rangeNote = range === "24h" ? "last 24 hours" : range === "7d" ? "last 7 days" : "last 30 days";

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <h1 className="text-[28px] font-medium leading-9 text-zinc-50">Overview</h1>
          <p className="mt-1 text-sm text-zinc-400">
            <span className="font-mono text-zinc-300">acme.com</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pills label="Date range" options={RANGES} value={range} onChange={setRange} />
          <Dropdown
            label="Country"
            icon={<Globe2 className="h-4 w-4" strokeWidth={1.5} />}
            value={country}
            options={COUNTRIES.map((c) => ({ name: c.name, hint: `${Math.round(c.share * 100)}%` }))}
            onSelect={setCountry}
            allLabel="All countries"
          />
          <Dropdown
            label="Device"
            icon={device ? DEVICE_ICON[device] : <Monitor className="h-4 w-4" strokeWidth={1.5} />}
            value={device}
            options={DEVICES.Device!.map((d) => ({ name: d.name }))}
            onSelect={setDevice}
            allLabel="All devices"
          />
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setCountry(null);
                setDevice(null);
              }}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs text-zinc-500 transition-colors hover:border-white/[0.16] hover:text-zinc-200"
            >
              <X className="h-4 w-4" strokeWidth={1.5} /> Clear
            </button>
          )}
          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#232325] px-3 text-xs text-zinc-200">
            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4cc38a]" />
            <span className="font-mono tabular-nums">{online}</span>
            <span className="text-zinc-400">online now</span>
          </span>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Visitors" value={fmtNumber(k.visitors)} delta={change(k.visitors, k.prev.visitors)} compare={compare} />
          <Stat label="Sessions" value={fmtNumber(k.sessions)} delta={change(k.sessions, k.prev.sessions)} compare={compare} />
          <Stat label="Pageviews" value={fmtNumber(k.pageviews)} delta={change(k.pageviews, k.prev.pageviews)} compare={compare} />
          <Stat label="Bounce rate" value={fmtPercent(base.bounce)} delta={change(base.bounce, base.prev.bounce)} compare={compare} goodWhenDown />
        </div>

        <Card className="overflow-hidden px-0 pb-4 pt-5">
          <div className="px-5 pb-2">
            <h3 className="text-sm font-medium text-zinc-100">Traffic</h3>
            <p className="mt-1 text-xs leading-4 text-zinc-400">Visitors and sessions over the {rangeNote}</p>
          </div>
          <TrafficChart points={points} />
        </Card>

        <Card className="grid grid-cols-2 divide-white/[0.08] overflow-hidden lg:grid-cols-4 lg:divide-x">
          <div className="flex flex-col gap-4 p-5">
            <span className="text-sm text-zinc-400">Pages per session</span>
            <p className="text-[28px] font-medium leading-8 tabular-nums text-zinc-50">{base.pagesPerSession.toFixed(1)}</p>
            <p className="text-xs leading-4 text-zinc-500">
              <span className="font-mono" style={{ color: UP }}>{fmtChange(change(base.pagesPerSession, base.prev.pagesPerSession))}</span> {compare}
            </p>
          </div>
          <div className="flex flex-col gap-4 p-5">
            <span className="text-sm text-zinc-400">Session duration</span>
            <p className="text-[28px] font-medium leading-8 tabular-nums text-zinc-50">{fmtDuration(base.duration)}</p>
            <p className="text-xs leading-4 text-zinc-500">
              <span className="font-mono" style={{ color: UP }}>{fmtChange(change(base.duration, base.prev.duration))}</span> {compare}
            </p>
          </div>
          <button type="button" onClick={() => onOpen("vitals")} className="group flex flex-col gap-4 p-5 text-left transition-colors hover:bg-white/[0.02]">
            <span className="flex items-center justify-between text-sm text-zinc-400">
              Web Vitals
              <ArrowUpRight className="h-4 w-4 text-zinc-600 transition-colors group-hover:text-zinc-300" strokeWidth={1.5} />
            </span>
            <p className="text-[28px] font-medium leading-8 tabular-nums text-zinc-50">92%</p>
            <p className="text-xs leading-4 text-zinc-500">
              <span className="font-mono" style={{ color: UP }}>Good</span> · 4,812 samples
            </p>
          </button>
          <div className="flex flex-col gap-4 p-5">
            <span className="text-sm text-zinc-400">Online now</span>
            <p className="text-[28px] font-medium leading-8 tabular-nums text-zinc-50">{online}</p>
            <p className="text-xs leading-4 text-zinc-500">Visitors in the last 5 minutes</p>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <CardHead title="Top sources" note="Where visitors come from" right={<span className="font-mono text-xs text-zinc-500">Visitors · share</span>} />
            <RankingList items={SOURCES} total={k.visitors} />
          </Card>
          <Card className="p-5">
            <CardHead title="Top pages" note="Most viewed routes" right={<span className="font-mono text-xs text-zinc-500">Pageviews · share</span>} />
            <RankingList items={TOP_PAGES} total={k.pageviews} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <CardHead
              title="Locations"
              note={`${COUNTRIES.length} countries with visitors`}
              right={
                <button type="button" onClick={() => onOpen("geography")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white">
                  Geography <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
                </button>
              }
            />
            <button type="button" onClick={() => onOpen("geography")} aria-label="Open audience geography" className="relative block h-[300px] w-full overflow-hidden rounded-lg bg-[#0f0f10]">
              <GlyphField variant="globe" cell={8} />
              <span className="absolute bottom-3 left-3 rounded-md bg-[#141415]/90 px-2 py-1 font-mono text-xs text-zinc-300">
                {COUNTRIES[0]!.name} {Math.round(COUNTRIES[0]!.share * 100)}% · {COUNTRIES[1]!.name} {Math.round(COUNTRIES[1]!.share * 100)}%
              </span>
            </button>
          </Card>
          <Card className="p-5">
            <CardHead title="Devices" note="What visitors browse on" right={<Pills label="Breakdown" options={["Device", "Browser", "OS"] as const} value={tab} onChange={setTab} />} />
            <RankingList items={DEVICES[tab] as Share[]} total={k.visitors} />
          </Card>
        </div>

        <Card className="p-5">
          <CardHead
            title="Top journeys"
            note="The full visitor flow, from entry page to the last step"
            right={
              <button type="button" onClick={() => onOpen("journeys")} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white">
                Open journeys <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            }
          />
          <ul className="space-y-0.5">
            {JOURNEYS.slice(0, 4).map((j) => (
              <li key={j.path.join(">")} className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/[0.04]">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-zinc-200">
                  {j.path.map((step, s) => (
                    <React.Fragment key={s}>
                      {s > 0 && <span className="text-zinc-600">→</span>}
                      <span className={step.startsWith("(") ? "text-zinc-500" : ""}>{step}</span>
                    </React.Fragment>
                  ))}
                </div>
                <span className="font-mono text-xs tabular-nums text-zinc-300">{fmtNumber(j.sessions * (base.visitors / kpis("30d").visitors) * factor)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Preview */

function Preview({ view, getStarted, onBack }: { view: Exclude<DemoViewId, "overview">; getStarted: string; onBack: () => void }) {
  const p = PREVIEWS[view];
  return (
    <>
      <div className="mb-6">
        <h1 className="text-[28px] font-medium leading-9 text-zinc-50">{p.title}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          <span className="font-mono text-zinc-300">acme.com</span>
        </p>
      </div>
      <Card className="grid overflow-hidden lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col justify-center p-8 sm:p-10">
          <p className="text-sm text-zinc-500">Try it in your workspace</p>
          <h2 className="mt-3 text-[28px] font-medium leading-9 tracking-[-0.02em] text-zinc-50">{p.headline}</h2>
          <p className="mt-3 max-w-md text-[15px] leading-6 text-zinc-400">{p.body}</p>
          <ul className="mt-6 space-y-3">
            {p.points.map((point) => (
              <li key={point} className="flex gap-3 text-sm leading-5 text-zinc-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" strokeWidth={1.5} />
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={getStarted}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ededed] px-4 text-sm font-medium text-[#141415] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-colors hover:bg-white"
            >
              Create workspace
            </a>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-10 items-center rounded-lg border border-white/[0.1] bg-[#232325]/80 px-4 text-sm text-zinc-100 transition-colors hover:border-white/[0.2]"
            >
              Back to Overview
            </button>
          </div>
        </div>
        <div className="relative min-h-[300px] border-t border-white/[0.08] bg-[#0f0f10] lg:border-l lg:border-t-0">
          <GlyphField variant={p.art} cell={9} />
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ Shell */

export function DemoDashboard({ getStarted = "/signup" }: { getStarted?: string }) {
  const [view, setView] = React.useState<DemoViewId>("overview");
  const [collapsed, setCollapsed] = React.useState(false);
  const [range, setRange] = React.useState<RangeKey>("7d");
  const [country, setCountry] = React.useState<string | null>(null);
  const [device, setDevice] = React.useState<string | null>(null);

  // The page can drive the demo: a tag, a chip or a menu entry sends an action.
  React.useEffect(() => {
    const onAction = (e: Event) => {
      const a = (e as CustomEvent<DemoAction>).detail;
      if (!a) return;
      if (a.range) setRange(a.range);
      if (a.country !== undefined) setCountry(a.country);
      if (a.device !== undefined) setDevice(a.device);
      setView(a.view ?? "overview");
    };
    window.addEventListener(DEMO_EVENT, onAction);
    return () => window.removeEventListener(DEMO_EVENT, onAction);
  }, []);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.id === view;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setView(item.id)}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg text-sm transition-colors duration-150 md:w-full ${
          collapsed ? "justify-center md:mx-auto md:w-8" : "gap-3 px-3"
        } ${active ? "bg-[#232325] font-medium text-zinc-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300"}`} strokeWidth={1.5} />
        {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
        {!collapsed && item.live && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4cc38a]" aria-label="Live" />}
      </button>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0f0f10] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.7)]">
      <div className="flex h-10 items-center gap-2 border-b border-white/[0.08] px-4">
        <i className="h-2.5 w-2.5 rounded-full bg-[#232325]" />
        <i className="h-2.5 w-2.5 rounded-full bg-[#232325]" />
        <i className="h-2.5 w-2.5 rounded-full bg-[#232325]" />
        <span className="ml-4 truncate font-mono text-xs text-zinc-500">Sample data · acme.com · {view}</span>
      </div>

      <div className={`grid md:h-[760px] ${collapsed ? "md:grid-cols-[64px_1fr]" : "md:grid-cols-[240px_1fr]"} transition-[grid-template-columns] duration-300`}>
        <aside className="flex min-h-0 flex-col justify-between border-b border-white/[0.08] bg-[#0f0f10] md:border-b-0 md:border-r">
          <div className="min-h-0">
            <div className={`flex h-14 items-center border-b border-white/[0.08] px-3 ${collapsed ? "justify-center" : "justify-between"}`}>
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-zinc-100 text-zinc-950">
                  <Activity className="h-4 w-4" strokeWidth={1.5} />
                </span>
                {!collapsed && <span className="text-base font-medium leading-none text-zinc-100">TrackMe</span>}
              </div>
              {!collapsed && (
                <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" className="hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 md:flex">
                  <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
            {collapsed && (
              <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand sidebar" className="mx-auto mt-2 hidden h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 md:flex">
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}

            <nav aria-label="Demo navigation" className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-6 md:overflow-y-auto md:py-4">
              <div className="flex gap-1 md:block md:space-y-2">
                {!collapsed && <p className="hidden px-3 text-xs text-zinc-500 md:block">Analytics</p>}
                <div className="flex gap-1 md:block md:space-y-0.5">{ANALYTICS.map(renderItem)}</div>
              </div>
              <div className="hidden md:block md:space-y-2">
                {!collapsed && <p className="px-3 text-xs text-zinc-500">Workspace</p>}
                <div className="space-y-0.5">{WORKSPACE.map(renderItem)}</div>
              </div>
            </nav>
          </div>

          <div className="hidden border-t border-white/[0.08] p-2 md:block">
            <div className={`flex items-center rounded-md p-2 ${collapsed ? "justify-center" : "gap-3"}`}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#232325] text-[10px] text-zinc-200">DM</span>
              {!collapsed && (
                <div className="min-w-0">
                  <p className="truncate text-xs text-zinc-200">demo@acme.com</p>
                  <p className="truncate text-xs text-zinc-500">Workspace Owner</p>
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col bg-[#141415]">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] px-4 text-xs sm:px-6">
            <span className="flex items-center gap-1 rounded-md px-1 py-0.5 font-medium text-zinc-500">
              Acme <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-700" strokeWidth={1.5} />
            <span className="flex items-center gap-2 rounded-md px-2 py-1 font-medium text-zinc-400">
              <Globe className="h-4 w-4 text-zinc-600" strokeWidth={1.5} />
              <span className="font-mono">acme.com</span>
              <ChevronDown className="h-4 w-4 text-zinc-600" strokeWidth={1.5} />
            </span>
            <ChevronRight className="hidden h-4 w-4 shrink-0 text-zinc-700 sm:block" strokeWidth={1.5} />
            <span className="hidden truncate text-zinc-300 sm:inline">{BREADCRUMB[view]}</span>
          </header>

          <div className="min-h-0 flex-1 p-4 sm:p-6 md:overflow-y-auto md:p-8">
            {view === "overview" ? <Overview onOpen={setView} filters={{ range, setRange, country, setCountry, device, setDevice }} /> : <Preview view={view} getStarted={getStarted} onBack={() => setView("overview")} />}
          </div>
        </div>
      </div>
    </div>
  );
}
