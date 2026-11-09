import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCheckoutFunnel, type CheckoutFunnel, type FunnelCounts } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { RangeSwitcher } from "@/components/range-switcher";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";
import { paymentRanges, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent } from "@/lib/format";

const TTL_SECONDS = 300;
/** A breakdown row with fewer checkout views than this is too small to compare. */
const MIN_VIEWS = 30;

export default async function CheckoutFunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const range = parseRangeKey((await searchParams).range);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { site } = context;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Checkout Funnel" art="steps" actions={<RangeSwitcher range={range} />}>
        Where shoppers drop between the checkout page and a captured payment on <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>
      <Suspense key={range} fallback={<TableCardSkeleton rows={5} cols={4} />}>
        <Body siteId={site.id} range={range} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, range }: { siteId: string; range: RangeKey }) {
  const { current } = paymentRanges(range);
  let funnel: CheckoutFunnel;
  try {
    funnel = await cached(`q:v1:pay:fn:${siteId}:${current.from}:${current.to}`, TTL_SECONDS, () => getCheckoutFunnel(siteId, current));
  } catch {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">The checkout funnel is temporarily unavailable.</p>
        <p className="mt-1 text-xs text-zinc-500">Nothing is lost. Reload in a moment.</p>
      </Card>
    );
  }
  if (funnel.viewed === 0) {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">Nobody viewed the checkout page in this period.</p>
        <p className="mt-1 text-xs text-zinc-500">The funnel starts from pageviews of /checkout.</p>
      </Card>
    );
  }

  const steps = [
    { label: "Viewed checkout", n: funnel.viewed, hint: "Sessions that opened /checkout" },
    { label: "Started a payment", n: funnel.started, hint: "Reported an order with trackPayment" },
    { label: "Reached the gateway", n: funnel.reached, hint: "The gateway sent a notification for the order" },
    { label: "Paid", n: funnel.paid, hint: "A captured payment" },
  ];
  const noStarts = funnel.started === 0;

  return (
    <>
      <Card className="overflow-hidden px-0 pb-0">
        <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
          <CardTitle>Checkout to payment</CardTitle>
          <CardDescription>Every step counts sessions, so the steps are comparable. Overall: {formatPercent(rate(funnel.paid, funnel.viewed) ?? 0)} of checkout sessions paid.</CardDescription>
        </CardHeader>
        <ol>
          {steps.map((s, i) => {
            const prev = i === 0 ? null : steps[i - 1]!.n;
            const width = (s.n / funnel.viewed) * 100;
            const kept = prev === null ? null : rate(s.n, prev);
            return (
              <li key={s.label} className="border-t border-white/[0.04] px-5 py-3 first:border-t-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-zinc-100">{s.label}</span>
                  <span className="font-mono text-sm tabular-nums text-zinc-50">
                    {formatNumber(s.n)}
                    {kept !== null && <span className="ml-2 text-xs text-zinc-500">{formatPercent(kept)} of previous</span>}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/[0.06]" aria-hidden="true">
                  <div className="h-2 rounded-full bg-zinc-200" style={{ width: `${Math.max(width, s.n > 0 ? 1 : 0)}%` }} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">{s.hint}</p>
              </li>
            );
          })}
        </ol>
        {noStarts && (
          <p className="border-t border-white/[0.06] px-5 py-3 text-xs text-amber-300/90">
            No payment was reported from the browser. Add trackme.trackPayment(&quot;initiated&quot;, {"{ orderId }"}) where the shopper presses pay; the snippet is on the Integrations page.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Split title="By browser" rows={funnel.byBrowser} overall={funnel} />
        <Split title="By device" rows={funnel.byDevice} overall={funnel} />
      </div>
    </>
  );
}

function Split({ title, rows, overall }: { title: string; rows: Array<{ key: string } & FunnelCounts>; overall: FunnelCounts }) {
  const base = rate(overall.paid, overall.viewed) ?? 0;
  return (
    <Card className="overflow-hidden px-0 pb-0">
      <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
        <CardTitle>{title}</CardTitle>
        <CardDescription>Paid as a share of checkout views. Groups under {MIN_VIEWS} views are too small to compare.</CardDescription>
      </CardHeader>
      <table className="w-full text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="px-5 py-2 text-left font-normal">Name</th>
            <th className="px-2 py-2 text-right font-normal">Viewed</th>
            <th className="px-2 py-2 text-right font-normal">Paid</th>
            <th className="px-5 py-2 text-right font-normal">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const conv = rate(m.paid, m.viewed);
            const small = m.viewed < MIN_VIEWS;
            const worse = !small && conv !== null && conv < base - 10;
            return (
              <tr key={m.key} className="border-t border-white/[0.04]">
                <td className="px-5 py-2 text-zinc-200">{m.key}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-400">{formatNumber(m.viewed)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-400">{formatNumber(m.paid)}</td>
                <td className={`px-5 py-2 text-right tabular-nums ${worse ? "text-[#e5484d]" : small ? "text-zinc-500" : "text-zinc-50"}`}>
                  {conv === null ? "–" : formatPercent(conv)}
                  {small && <span className="ml-1 text-xs">small</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
