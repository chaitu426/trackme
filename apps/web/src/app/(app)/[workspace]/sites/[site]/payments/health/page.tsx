import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { getGatewayHealth, type GatewayHealth, type GatewayWindow } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { AutoRefresh } from "@/components/auto-refresh";
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
      <AutoRefresh />
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
    health = await cached(`q:v1:pay:health:${siteId}`, TTL_SECONDS, () => getGatewayHealth(siteId));
  } catch {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">Gateway health is temporarily unavailable.</p>
        <p className="mt-1 text-xs text-zinc-500">Nothing is lost. Reload in a moment.</p>
      </Card>
    );
  }
  if (health.length === 0) {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">No gateway activity in the last 7 days.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Connect a gateway under <Link className="underline" href={`${base}/connect`}>Integrations</Link>.
        </p>
      </Card>
    );
  }

  return (
    <>
      {health.map((g) => {
        const ongoing = g.incidents.find((i) => i.ongoing);
        const degraded = g.last1h.successRate !== null && g.baseline !== null && g.last1h.successRate < g.baseline - 0.15;
        return (
          <Card key={g.gateway} className="overflow-hidden px-0 pb-0">
            <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] px-5 pb-3">
              <div>
                <CardTitle className="capitalize">{g.gateway}</CardTitle>
                <CardDescription>
                  {g.lastEventAt ? `Last notification ${formatRelativeTime(g.lastEventAt)}` : "No notifications"}
                  {g.baseline !== null && ` · normally ${formatPercent(g.baseline * 100)} succeed`}
                </CardDescription>
              </div>
              {ongoing ? <Badge>Incident in progress</Badge> : degraded ? <Badge>Degraded</Badge> : <Badge>Healthy</Badge>}
            </CardHeader>
            <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.06] text-center">
              {([["Last 5 minutes", g.last5m], ["Last hour", g.last1h], ["Last 24 hours", g.last24h]] as const).map(([label, w]) => (
                <div key={label} className="px-3 py-4">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-1 text-2xl font-medium tabular-nums text-zinc-50">{pct(w)}</p>
                  <p className="text-xs text-zinc-500">{w.outcomes === 0 ? "no payments" : `${formatNumber(w.outcomes)} payments`}{w.outcomes > 0 && w.successRate === null ? " (too few)" : ""}</p>
                </div>
              ))}
            </div>
            <div className="px-5 py-3">
              <p className="text-xs font-medium text-zinc-400">Incidents, last 7 days</p>
              {g.incidents.length === 0 ? (
                <p className="py-2 text-xs text-zinc-500">None. The success rate stayed within what is normal for this gateway.</p>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {g.incidents.map((i) => (
                    <li key={i.startMs} className="py-2 text-sm">
                      <span className="text-zinc-100">{when(i.startMs)} to {i.ongoing ? "now" : when(i.endMs)}</span>
                      <span className="ml-2 text-zinc-400">
                        {formatPercent(i.successRate * 100)} succeeded, {formatNumber(i.failed)} of {formatNumber(i.outcomes)} failed
                      </span>
                      {i.topFailure && <code className="ml-2 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-zinc-300">{i.topFailure}</code>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
      <p className="text-xs text-zinc-500">
        A stretch counts as an incident when its failures are too many to be chance given the gateway&apos;s own normal failure rate (under 1 in 1,000),
        and at least five payments failed. This tells you something is wrong; it cannot tell whether the cause is the gateway, a bank or your own checkout.
      </p>
    </>
  );
}
