import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { getPaymentsOverview, type PaymentBreakdownRow } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { RankedBars } from "@/components/ui/ranked-bar";
import { RangeSwitcher } from "@/components/range-switcher";
import { RevenueChart } from "@/components/revenue-chart";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";
import { chooseCurrency, fillDays, formatMoney, paymentRanges, pctChange, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent } from "@/lib/format";

const TTL_SECONDS = 300;
/** Below this success rate a method or gateway is shown as a problem. */
const WEAK_SUCCESS = 85;
/** A change against a tiny previous period can be thousands of percent; past 999 it is shown as a bound, not a precise figure. */
const change = (v: number | null) => (v === null ? undefined : Math.abs(v) > 999 ? `${v > 0 ? ">" : "<-"}999%` : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

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
      <Empty title="Payments are temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>
    );
  }

  const cur = chooseCurrency(current.currencies, requested);
  if (!cur) {
    return (
      <Empty
        icon={Landmark}
        title="No payments in this period"
        action={
          <Link href={`${base}/connect`} className="press inline-flex h-9 items-center rounded-lg bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white">
            Connect a gateway
          </Link>
        }
      >
        Payments appear here as your gateway reports them.
      </Empty>
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
  const days = fillDays(current.daily, currency, r.current.from, r.current.to);
  const before = fillDays(previous.daily, currency, r.previous.from, r.previous.to);

  return (
    <>
      <div className="enter grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" style={{ ["--i" as string]: 0 }}>
        <StatsCard
          className="sm:col-span-2"
          title="Revenue"
          value={formatMoney(cur.revenueMinor, currency)}
          change={change(pctChange(cur.revenueMinor, prev?.revenueMinor ?? 0))}
          isPositive={cur.revenueMinor >= (prev?.revenueMinor ?? 0)}
        />
        <StatsCard
          title="Success rate"
          value={successRate === null ? "–" : formatPercent(successRate)}
          change={successRate !== null && prevRate !== null ? `${successRate - prevRate > 0 ? "+" : ""}${(successRate - prevRate).toFixed(1)} pts` : undefined}
          isPositive={successRate !== null && prevRate !== null && successRate >= prevRate}
        />
        <StatsCard title="Successful payments" value={formatNumber(cur.paid)} change={change(pctChange(cur.paid, prev?.paid ?? 0))} isPositive={cur.paid >= (prev?.paid ?? 0)} />
        <StatsCard title="Average order" value={cur.paid > 0 ? formatMoney(aov, currency) : "–"} change={change(pctChange(aov, prevAov))} isPositive={aov >= prevAov} />
        <StatsCard
          title="Per paying customer"
          value={cur.payers > 0 ? formatMoney(arppu, currency) : "–"}
          change={change(pctChange(arppu, prevArppu))}
          isPositive={arppu >= prevArppu}
        />
      </div>

      <Card className="enter overflow-hidden px-0 pb-0" >
        <CardHeader className="flex-row items-start justify-between gap-4 px-5 pb-2">
          <div>
            <CardTitle>Revenue per day</CardTitle>
            <CardDescription>
              Captured payments in {currency}, by the day the payment started (UTC){cur.refundedMinor > 0 ? `. ${formatMoney(cur.refundedMinor, currency)} was refunded in this period.` : ""}
            </CardDescription>
          </div>
          {current.currencies.length > 1 && (
            <Segmented
              label="Currency"
              items={current.currencies.map((c) => ({ href: `?range=${range}&currency=${c.currency}`, label: c.currency, active: c.currency === currency }))}
            />
          )}
        </CardHeader>
        <RevenueChart points={days} previous={before} currency={currency} />
      </Card>

      <div className="enter grid gap-4 lg:grid-cols-3" style={{ ["--i" as string]: 2 }}>
        <Breakdown className="lg:col-span-2" title="Payment methods" note="Bar is the share of revenue. Success is shown beside the revenue." rows={current.byMethod.filter((m) => m.currency === currency)} currency={currency} />
        <Breakdown title="Gateways" note="Same measures per gateway" rows={current.byGateway.filter((m) => m.currency === currency)} currency={currency} />
      </div>

      <p className="text-xs leading-5 text-zinc-500">
        Success rate counts payments that ended in success or in failure; a payment that failed and then succeeded on retry counts as a success. Per paying customer is
        revenue divided by distinct paying customers, because anonymous visitors cannot be followed across days.
      </p>
    </>
  );
}

function Breakdown({ title, note, rows, currency, className }: { title: string; note: string; rows: PaymentBreakdownRow[]; currency: string; className?: string }) {
  const total = rows.reduce((s, m) => s + m.revenueMinor, 0) || 1;
  return (
    <Card className={`overflow-hidden px-0 pb-0 ${className ?? ""}`}>
      <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <RankedBars
        rows={[...rows]
          .sort((a, b) => b.revenueMinor - a.revenueMinor)
          .map((m, i) => {
            const success = m.attempts > 0 ? (m.paid / m.attempts) * 100 : null;
            return {
              key: m.key,
              label: <span className="capitalize">{m.key}</span>,
              share: m.revenueMinor / total,
              value: formatMoney(m.revenueMinor, currency),
              meta: success === null ? "" : `${formatPercent(success)} success`,
              emphasis: i === 0,
              bad: success !== null && m.attempts >= 20 && success < WEAK_SUCCESS,
            };
          })}
      />
    </Card>
  );
}
