import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { getGatewayHealth, type GatewayHealth, type GatewayWindow } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { StatusDot } from "@/components/ui/status-dot";
import { AutoRefresh } from "@/components/auto-refresh";
import { HealthStrip } from "@/components/health-strip";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { formatNumber, formatPercent, formatRelativeTime } from "@/lib/format";

const TTL_SECONDS = 30;

export default async function GatewayHealthPage({ params }: { params: Promise<{ workspace: string; site: string }> }) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Gateway Health" art="gauge">
        Live success rate per gateway, and the stretches where it fell well below normal, for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>
      <AutoRefresh intervalMs={30_000} />
      <Suspense fallback={<TableCardSkeleton rows={4} cols={4} />}>
        <Body siteId={site.id} base={`/${workspace.slug}/sites/${site.domain}/payments`} />
      </Suspense>
    </div>
  );
}

const pct = (w: GatewayWindow) => (w.successRate === null ? "–" : formatPercent(w.successRate * 100));
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function Body({ siteId, base }: { siteId: string; base: string }) {
  let health: GatewayHealth[];
  try {
    health = await cached(`q:v2:pay:health:${siteId}`, TTL_SECONDS, () => getGatewayHealth(siteId));
  } catch {
    return <Empty title="Gateway health is temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>;
  }
  if (health.length === 0) {
    return (
      <Empty
        icon={Activity}
        title="No gateway activity in the last 7 days"
        action={
          <Link href={`${base}/connect`} className="press inline-flex h-9 items-center rounded-lg bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white">
            Connect a gateway
          </Link>
        }
      >
        Health appears once the gateway starts sending payment notifications.
      </Empty>
    );
  }

  return (
    <>
      {health.map((g, index) => {
        const ongoing = g.incidents.find((i) => i.ongoing);
        const degraded = g.last1h.successRate !== null && g.baseline !== null && g.last1h.successRate < g.baseline - 0.15;
        const status = ongoing ? ({ tone: "bad", label: "Incident in progress" } as const) : degraded ? ({ tone: "warn", label: "Below normal" } as const) : ({ tone: "ok", label: "Healthy" } as const);
        return (
          <Card key={g.gateway} className="enter overflow-hidden px-0 pb-0" >
            <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] px-5 pb-3" >
              <div>
                <CardTitle className="capitalize">{g.gateway}</CardTitle>
                <CardDescription>
                  {g.lastEventAt ? `Last notification ${formatRelativeTime(g.lastEventAt)}` : "No notifications"}
                  {g.baseline !== null && ` · normally ${formatPercent(g.baseline * 100)} succeed`}
                </CardDescription>
              </div>
              <StatusDot tone={status.tone} label={status.label} live={status.tone === "bad"} />
            </CardHeader>

            <div className="grid divide-white/[0.06] sm:grid-cols-3 sm:divide-x" style={{ ["--i" as string]: index }}>
              {([["Last 5 minutes", g.last5m], ["Last hour", g.last1h], ["Last 24 hours", g.last24h]] as const).map(([label, w]) => (
                <div key={label} className="px-5 py-4">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-1 text-[28px] font-medium leading-8 tabular-nums text-zinc-50">{pct(w)}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {w.outcomes === 0 ? "No payments" : `${formatNumber(w.outcomes)} payments${w.successRate === null ? ", too few to judge" : ""}`}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-white/[0.06] px-5 py-4">
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-xs font-medium text-zinc-300">Last 6 hours</p>
                <p className="text-xs text-zinc-500">Height is payments finished, colour is how they went</p>
              </div>
              <HealthStrip buckets={g.recent} />
            </div>

            <div className="border-t border-white/[0.06] px-5 py-4">
              <p className="text-xs font-medium text-zinc-300">Incidents, last 7 days</p>
              {g.incidents.length === 0 ? (
                <p className="py-2 text-xs text-zinc-500">None. The success rate stayed within what is normal for this gateway.</p>
              ) : (
                <ul className="mt-2 divide-y divide-white/[0.04]">
                  {g.incidents.map((i) => (
                    <li key={i.startMs} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
                      <span className="text-zinc-100">
                        {when(i.startMs)} to {i.ongoing ? "now" : when(i.endMs)}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[#e5484d]">
                        {formatNumber(i.failed)} of {formatNumber(i.outcomes)} failed
                      </span>
                      {i.topFailure && <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-zinc-300">{i.topFailure}</code>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
      <p className="text-xs leading-5 text-zinc-500">
        A stretch counts as an incident when its failures are too many to be chance given the gateway&apos;s own normal failure rate (under 1 in 1,000), and at least five
        payments failed. It tells you something is wrong; it cannot tell whether the cause is the gateway, a bank or your own checkout.
      </p>
    </>
  );
}
