import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { getPaymentsOverview, type PaymentBreakdownRow } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { RangeSwitcher } from "@/components/range-switcher";
import { RevenueBars } from "@/components/revenue-bars";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";
import { chooseCurrency, fillDays, formatMoney, paymentRanges, pctChange, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent } from "@/lib/format";

const TTL_SECONDS = 300;
const change = (v: number | null) => (v === null ? undefined : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

export default async function PaymentsOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const sp = await searchParams;
  const range = parseRangeKey(sp.range);
  const requested = typeof sp.currency === "string" ? sp.currency : undefined;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const base = `/${workspace.slug}/sites/${site.domain}/payments`;

  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Payments Overview" art="gauge" actions={<RangeSwitcher range={range} extraQuery={requested ? `&currency=${encodeURIComponent(requested)}` : ""} />}>
        Revenue and payment success for <span className="font-mono text-zinc-300">{site.domain}</span>, from your gateway&apos;s webhooks
      </PageHeader>
      <Suspense key={`${range}:${requested}`} fallback={<TableCardSkeleton rows={6} cols={4} />}>
        <Body siteId={site.id} range={range} requested={requested} base={base} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, range, requested, base }: { siteId: string; range: RangeKey; requested: string | undefined; base: string }) {
  const r = paymentRanges(range);
  let current, previous;
  try {
    [current, previous] = await Promise.all([
      cached(`q:v1:pay:ov:${siteId}:${r.current.from}:${r.current.to}`, TTL_SECONDS, () => getPaymentsOverview(siteId, r.current)),
      cached(`q:v1:pay:ov:${siteId}:${r.previous.from}:${r.previous.to}`, TTL_SECONDS, () => getPaymentsOverview(siteId, r.previous)),
    ]);
  } catch {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">Payments are temporarily unavailable.</p>
        <p className="mt-1 text-xs text-zinc-500">Nothing is lost. Reload in a moment.</p>
      </Card>
    );
  }

  const cur = chooseCurrency(current.currencies, requested);
  if (!cur) {
    return (
      <Card className="py-12 text-center">
        <p className="text-sm text-zinc-300">No payments in this period.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Connect a gateway under <Link className="underline" href={`${base}/connect`}>Integrations</Link> and payments appear here as the gateway reports them.
        </p>
      </Card>
    );
  }
  const prev = previous.currencies.find((c) => c.currency === cur.currency);
  const { currency } = cur;

  const successRate = rate(cur.paid, cur.paid + cur.failed);
  const prevRate = prev ? rate(prev.paid, prev.paid + prev.failed) : null;
  const aov = cur.paid > 0 ? cur.revenueMinor / cur.paid : 0;
  const prevAov = prev && prev.paid > 0 ? prev.revenueMinor / prev.paid : 0;
  const arppu = cur.payers > 0 ? cur.revenueMinor / cur.payers : 0;
  const prevArppu = prev && prev.payers > 0 ? prev.revenueMinor / prev.payers : 0;
  const methods = current.byMethod.filter((m) => m.currency === currency);
  const gateways = current.byGateway.filter((m) => m.currency === currency);

  return (
    <>
      {current.currencies.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span>Currency</span>
          {current.currencies.map((c) => (
            <Link
              key={c.currency}
              href={`?range=${range}&currency=${c.currency}`}
              className={`rounded-md border px-2.5 py-1 ${c.currency === currency ? "border-white/[0.2] bg-raised text-zinc-50" : "border-border hover:text-zinc-100"}`}
            >
              {c.currency}
            </Link>
          ))}
          <span className="text-zinc-600">Currencies are never added together.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatsCard
          title="Revenue"
          value={formatMoney(cur.revenueMinor, currency, true)}
          change={change(pctChange(cur.revenueMinor, prev?.revenueMinor ?? 0))}
          isPositive={cur.revenueMinor >= (prev?.revenueMinor ?? 0)}
          {...(cur.refundedMinor > 0 ? { subtitle: `${formatMoney(cur.refundedMinor, currency)} refunded` } : {})}
        />
        <StatsCard
          title="Successful payments"
          value={formatNumber(cur.paid)}
          change={change(pctChange(cur.paid, prev?.paid ?? 0))}
          isPositive={cur.paid >= (prev?.paid ?? 0)}
        />
        <StatsCard
          title="Success rate"
          value={successRate === null ? "–" : formatPercent(successRate)}
          change={successRate !== null && prevRate !== null ? `${successRate - prevRate > 0 ? "+" : ""}${(successRate - prevRate).toFixed(1)} pts` : undefined}
          isPositive={successRate !== null && prevRate !== null && successRate >= prevRate}
          subtitle={`${formatNumber(cur.failed)} failed for good`}
        />
        <StatsCard
          title="Average order value"
          value={cur.paid > 0 ? formatMoney(aov, currency) : "–"}
          change={change(pctChange(aov, prevAov))}
          isPositive={aov >= prevAov}
        />
        <StatsCard
          title="Revenue per paying customer"
          value={cur.payers > 0 ? formatMoney(arppu, currency) : "–"}
          change={change(pctChange(arppu, prevArppu))}
          isPositive={arppu >= prevArppu}
          subtitle={`${formatNumber(cur.payers)} paying`}
        />
      </div>

      <Card className="overflow-hidden px-0 pb-0">
        <CardHeader className="px-5 pb-3">
          <CardTitle>Revenue per day</CardTitle>
          <CardDescription>Captured payments in {currency}, by the day the payment started (UTC).</CardDescription>
        </CardHeader>
        <RevenueBars points={fillDays(current.daily, currency, r.current.from, r.current.to)} currency={currency} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable title="By payment method" rows={methods} currency={currency} />
        <BreakdownTable title="By gateway" rows={gateways} currency={currency} />
      </div>

      <p className="text-xs text-zinc-500">
        Success rate counts payments that ended in success or in failure; a payment that failed and then succeeded on retry counts as a success.
        Revenue per paying customer is revenue divided by distinct paying customers (anonymous visitors cannot be followed, so this is not per visitor).
      </p>
    </>
  );
}

function BreakdownTable({ title, rows, currency }: { title: string; rows: PaymentBreakdownRow[]; currency: string }) {
  return (
    <Card className="overflow-hidden px-0 pb-0">
      <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <table className="w-full text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="px-5 py-2 text-left font-normal">Name</th>
            <th className="px-2 py-2 text-right font-normal">Attempts</th>
            <th className="px-2 py-2 text-right font-normal">Success</th>
            <th className="px-5 py-2 text-right font-normal">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.key} className="border-t border-white/[0.04]">
              <td className="px-5 py-2 capitalize text-zinc-200">{m.key}</td>
              <td className="px-2 py-2 text-right tabular-nums text-zinc-400">{formatNumber(m.attempts)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-zinc-400">{m.attempts > 0 ? formatPercent((m.paid / m.attempts) * 100) : "–"}</td>
              <td className="px-5 py-2 text-right tabular-nums text-zinc-50">{formatMoney(m.revenueMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
