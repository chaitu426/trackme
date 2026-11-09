import Link from "next/link";
import { Segmented } from "@/components/ui/segmented";
import { Filter, LogOut, Route as RouteIcon, X } from "lucide-react";
import type { JourneySegment, RouteSummary, TraceStep } from "@trackme/analytics";
import {
  cachedJourneyGraph,
  cachedJourneyRoutes,
  cachedJourneySegments,
  cachedJourneyTrace,
} from "@/lib/cached-analytics";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { FlagImage } from "@/components/ui/flag-image";
import { JourneySankey } from "@/components/journey-sankey";
import { RouteFlow } from "@/components/route-flow";
import { buildMetricRequest } from "@/lib/metrics";
import { resolveDateRange, type RangeKey } from "@/lib/date-range";
import { countryName } from "@/lib/countries";
import { formatNumber } from "@/lib/format";
import { pageColor, shortPath } from "@/lib/page-color";

export const ROUTE_SEPARATOR = " → ";
const ROUTE_LIMIT = 12;

export interface JourneyContext {
  workspaceId: string;
  siteId: string;
  /** Base path of this page, e.g. /demo/sites/example.com/journeys */
  basePath: string;
  range: RangeKey;
  segment: JourneySegment;
  /** The route the visitor picked, if any. */
  route: string[] | null;
}

export function journeyHref(ctx: Pick<JourneyContext, "basePath" | "range" | "segment">, route: string[] | null): string {
  const params = new URLSearchParams({ range: ctx.range, segment: ctx.segment });
  if (route && route.length > 0) params.set("route", route.join(ROUTE_SEPARATOR));
  return `${ctx.basePath}?${params.toString()}`;
}

const request = (ctx: JourneyContext) =>
  buildMetricRequest(ctx.workspaceId, ctx.siteId, resolveDateRange(ctx.range).current, { limit: ROUTE_LIMIT });

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/* ───────────────────────────── Flow + headline numbers ───────────────────────────── */

export async function FlowSection(ctx: JourneyContext) {
  const req = request(ctx);
  const [graph, report] = await Promise.all([cachedJourneyGraph(req), cachedJourneyRoutes(req, ROUTE_LIMIT)]);

  const entry = graph.nodes.filter((n) => n.step === 1).sort((a, b) => b.sessions - a.sessions)[0];
  const exits = new Map<string, number>();
  for (const link of graph.links) {
    if (!link.target.endsWith(":__exit__")) continue;
    const source = graph.nodes.find((n) => n.id === link.source);
    if (source && source.page !== "__other__") exits.set(source.page, (exits.get(source.page) ?? 0) + link.sessions);
  }
  const topExit = [...exits.entries()].sort((a, b) => b[1] - a[1])[0];
  const multi = Math.max(0, report.totalSessions - report.singlePageSessions);

  return (
    <div className="space-y-5 reveal">
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
        <StatsCard title="Sessions analysed" value={formatNumber(report.totalSessions)} subtitle="Human sessions with a page view" />
        <StatsCard
          title="Explored more than one page"
          value={`${pct(multi, report.totalSessions)}%`}
          subtitle={`${formatNumber(report.singlePageSessions)} left after a single page`}
        />
        <StatsCard
          title="Top entry page"
          value={entry ? shortPath(entry.page, 16) : "–"}
          subtitle={entry ? `${pct(entry.sessions, graph.totalSessions)}% of sessions start here` : "No sessions yet"}
        />
        <StatsCard
          title="Top exit page"
          value={topExit ? shortPath(topExit[0], 16) : "–"}
          subtitle={topExit ? `${formatNumber(topExit[1])} sessions end here after 2+ pages` : "No exits yet"}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
          <div>
            <CardTitle>
              <RouteIcon className="h-4 w-4 text-zinc-200" />
              Visitor flow
            </CardTitle>
            <CardDescription>How sessions move from one page to the next, up to six pages deep</CardDescription>
          </div>
          {ctx.route && (
            <Link
              href={journeyHref(ctx, null)}
              scroll={false}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/[0.14] bg-white/[0.07] px-2 py-1 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/[0.07]"
            >
              Tracing one route <X className="h-4 w-4" />
            </Link>
          )}
        </CardHeader>
        <div className="pt-3">
          <JourneySankey graph={graph} {...(ctx.route ? { route: ctx.route } : {})} />
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────────── Routes list ───────────────────────────── */

export async function RoutesList(ctx: JourneyContext) {
  const { routes, totalSessions } = await cachedJourneyRoutes(request(ctx), ROUTE_LIMIT);
  const selected = (ctx.route ?? routes[0]?.route ?? []).join(ROUTE_SEPARATOR);
  const busiest = Math.max(...routes.map((r) => r.sessions), 1);

  return (
    <Card className="reveal">
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <CardTitle>
          <RouteIcon className="h-4 w-4 text-zinc-200" />
          Common routes
        </CardTitle>
        <CardDescription>Pick one to see every step, and where people went instead</CardDescription>
      </CardHeader>
      {routes.length === 0 ? (
        <p className="py-12 text-center text-xs text-zinc-500">No multi-page sessions in this range yet.</p>
      ) : (
        <ol className="space-y-0.5 pt-2">
          {routes.map((r, i) => (
            <RouteRow key={r.route.join("|")} ctx={ctx} route={r} rank={i + 1} busiest={busiest} total={totalSessions} selected={r.route.join(ROUTE_SEPARATOR) === selected} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function RouteRow({
  ctx,
  route,
  rank,
  busiest,
  total,
  selected,
}: {
  ctx: JourneyContext;
  route: RouteSummary;
  rank: number;
  busiest: number;
  total: number;
  selected: boolean;
}) {
  return (
    <li>
      <Link
        href={journeyHref(ctx, route.route)}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className={`group block rounded-lg px-3 py-3 transition-colors ${
          selected ? "bg-white/[0.06] ring-1 ring-inset ring-white/[0.1]" : "hover:bg-white/[0.035]"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right font-mono text-xs font-medium tabular-nums text-zinc-600">
            {String(rank).padStart(2, "0")}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
            {route.route.map((page, i) => (
              <span key={`${page}-${i}`} className="inline-flex items-center gap-1">
                <span
                  className="inline-flex max-w-[130px] items-center gap-2 truncate rounded-md border px-2 py-px font-mono text-[10.5px] text-zinc-200"
                  style={{ borderColor: `${pageColor(page)}40`, background: `${pageColor(page)}14` }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: pageColor(page) }} />
                  <span className="truncate">{page}</span>
                </span>
                {i < route.route.length - 1 && <span className="text-xs text-zinc-600">›</span>}
              </span>
            ))}
          </div>
          <div className="shrink-0 text-right font-mono tabular-nums">
            <p className="text-xs font-medium text-zinc-100">{formatNumber(route.sessions)}</p>
            <p className="text-xs text-zinc-500">{pct(route.sessions, total)}%</p>
          </div>
        </div>
        <div className="ml-8 mt-2 flex h-[5px] overflow-hidden rounded-full bg-white/[0.05]">
          {/* One segment per page, in the colours of the flow diagram */}
          <div className="flex h-full" style={{ width: `${Math.max((route.sessions / busiest) * 100, 2)}%` }}>
            {route.route.map((page, i) => (
              <span key={`${page}-${i}`} className="h-full flex-1 opacity-80" style={{ background: pageColor(page) }} />
            ))}
          </div>
        </div>
      </Link>
    </li>
  );
}

/* ───────────────────────────── Route detail ───────────────────────────── */

export async function RouteDetail(ctx: JourneyContext) {
  const req = request(ctx);
  let route = ctx.route;
  if (!route || route.length === 0) {
    route = (await cachedJourneyRoutes(req, ROUTE_LIMIT)).routes[0]?.route ?? null;
  }
  if (!route) {
    return (
      <Card className="flex min-h-[240px] items-center justify-center">
        <p className="text-xs text-zinc-500">Route detail appears once visitors view more than one page.</p>
      </Card>
    );
  }

  const steps = await cachedJourneyTrace(req, route);
  const entered = steps[0]?.sessions ?? 0;
  const completed = steps[steps.length - 1]?.sessions ?? 0;

  // The step where the most sessions went somewhere else or left.
  let leak: { from: TraceStep; lost: number } | null = null;
  for (let i = 0; i < steps.length - 1; i += 1) {
    const lost = steps[i]!.sessions - steps[i + 1]!.sessions;
    if (lost > 0 && (!leak || lost > leak.lost)) leak = { from: steps[i]!, lost };
  }

  return (
    <Card className="reveal">
      <CardHeader className="border-b border-white/[0.06] pb-3">
        <CardTitle>
          <RouteIcon className="h-4 w-4 text-zinc-200" />
          Route detail
        </CardTitle>
        <CardDescription>
          {formatNumber(entered)} sessions began this route; {formatNumber(completed)} ({pct(completed, entered)}%) followed it to the end
        </CardDescription>
      </CardHeader>

      {route.every((p) => p.startsWith("/")) && route.length >= 2 && (
        <div className="mt-3 flex justify-end">
          <Link
            href={`${ctx.basePath.replace(/\/journeys$/, "/funnels")}?${route.map((p) => `path=${encodeURIComponent(p)}`).join("&")}`}
            className="inline-flex items-center gap-2 rounded-md border border-white/[0.14] bg-white/[0.07] px-2.5 py-1.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/[0.12]"
          >
            <Filter className="h-3.5 w-3.5" />
            Turn this route into a funnel
          </Link>
        </div>
      )}

      {leak && (
        <p className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-zinc-300">
          Biggest leak: after <span className="font-mono font-medium">{leak.from.page}</span>,{" "}
          <span className="font-medium">{formatNumber(leak.lost)}</span> sessions ({pct(leak.lost, leak.from.sessions)}%) took another path or left.
        </p>
      )}

      <div className="pt-3">
        <RouteFlow steps={steps} />
      </div>

      <ol className="relative pt-5">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const width = pct(step.sessions, entered);
          const continued = next ? pct(next.sessions, step.sessions) : null;
          return (
            <li key={`${step.page}-${i}`} className="relative pb-5 pl-9 last:pb-0">
              {i < steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-white/[0.1]" />}
              <span
                className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium tabular-nums text-zinc-100"
                style={{ borderColor: `${pageColor(step.page)}80`, background: `${pageColor(step.page)}26` }}
              >
                {step.index}
              </span>

              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-mono text-xs font-medium text-zinc-100" title={step.page}>
                  {step.page}
                </p>
                <p className="shrink-0 font-mono text-xs tabular-nums">
                  <span className="font-medium text-zinc-100">{formatNumber(step.sessions)}</span>
                  <span className="ml-2 text-zinc-500">{i === 0 ? "entered" : `${width}% of entry`}</span>
                </p>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(width, step.sessions > 0 ? 1.5 : 0)}%`, background: pageColor(step.page) }}
                />
              </div>

              {(step.deviations.length > 0 || step.exits > 0) && next && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-600">Instead</span>
                  {step.deviations.map((d) => (
                    <span
                      key={d.page}
                      title={d.page}
                      className="inline-flex max-w-[190px] items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-px font-mono text-[10.5px] text-zinc-400"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: pageColor(d.page) }} />
                      <span className="truncate">{d.page}</span>
                      <span className="tabular-nums text-zinc-500">{formatNumber(d.sessions)}</span>
                    </span>
                  ))}
                  {step.exits > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-px font-mono text-[10.5px] text-zinc-500">
                      <LogOut className="h-4 w-4" />
                      left <span className="tabular-nums">{formatNumber(step.exits)}</span>
                    </span>
                  )}
                </div>
              )}

              {continued !== null && (
                <p className="mt-2 text-[10.5px] text-zinc-500">
                  <span className="font-medium text-zinc-200">{continued}%</span>{" "}
                  continue to the next step
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ───────────────────────────── Segment table ───────────────────────────── */

const SEGMENT_LABELS: Record<JourneySegment, string> = {
  device: "Device",
  country: "Country",
  browser: "Browser",
  os: "OS",
};

export function isJourneySegment(value: string | undefined): value is JourneySegment {
  return value === "device" || value === "country" || value === "browser" || value === "os";
}

export function SegmentTabs(ctx: JourneyContext) {
  return (
    <Segmented
      label="Break down by"
      items={(Object.keys(SEGMENT_LABELS) as JourneySegment[]).map((key) => ({ href: journeyHref({ ...ctx, segment: key }, ctx.route), label: SEGMENT_LABELS[key], active: key === ctx.segment }))}
    />
  );
}

export async function SegmentTable(ctx: JourneyContext) {
  const table = await cachedJourneySegments(request(ctx), ctx.segment);

  return (
    <Card className="reveal overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div>
          <CardTitle>Who reaches which page</CardTitle>
          <CardDescription>Share of each group&apos;s sessions that viewed the page, and how many</CardDescription>
        </div>
        <SegmentTabs {...ctx} />
      </CardHeader>

      {table.rows.length === 0 ? (
        <p className="py-12 text-center text-xs text-zinc-500">No sessions in this range yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-4 py-3 text-xs font-medium text-zinc-500">
                  {SEGMENT_LABELS[ctx.segment]}
                </th>
                {table.pages.map((page) => (
                  <th key={page} className="px-3 py-3 text-xs font-medium" title={page}>
                    <span className="inline-flex items-center gap-2 font-mono" style={{ color: pageColor(page) }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: pageColor(page) }} />
                      {shortPath(page, 16)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.segment} className="group">
                  <th className="sticky left-0 z-10 border-t border-white/[0.06] bg-card px-4 py-3 text-xs font-medium text-zinc-200">
                    <span className="flex items-center gap-2">
                      {ctx.segment === "country" && /^[A-Z]{2}$/.test(row.segment) && <FlagImage code={row.segment} size={16} />}
                      <span className="capitalize">{ctx.segment === "country" && /^[A-Z]{2}$/.test(row.segment) ? countryName(row.segment) : row.segment}</span>
                    </span>
                    <span className="mt-0.5 block font-mono text-xs font-normal text-zinc-600">{formatNumber(row.sessions)} sessions</span>
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.page} className="border-t border-white/[0.06] px-3 py-3">
                      <div
                        className="rounded-md px-2 py-2"
                        style={{ background: `${pageColor(cell.page)}${Math.round(Math.min(cell.pct, 100) * 0.35 + 4).toString(16).padStart(2, "0")}` }}
                      >
                        <p className="font-mono text-xs font-medium tabular-nums text-zinc-100">{cell.pct}%</p>
                        <p className="font-mono text-xs tabular-nums text-zinc-400">{formatNumber(cell.sessions)}</p>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
