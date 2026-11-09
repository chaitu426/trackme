import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RotateCcw } from "lucide-react";
import { CATEGORY_GUIDE, type FailureCategory } from "@trackme/payments";
import { getRecovery, type Recovery } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { RankedBars } from "@/components/ui/ranked-bar";
import { RangeSwitcher } from "@/components/range-switcher";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";
import { formatMoney, paymentRanges, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent } from "@/lib/format";

const TTL_SECONDS = 120;
/** A cause with at least this many failures and a recovery rate under this is flagged as leaking. */
const LOW_RECOVERY = 15;
const MIN_FAILED = 5;

export default async function RecoveryPage({ params, searchParams }: { params: Promise<{ workspace: string; site: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const sp = await searchParams;
  const range = parseRangeKey(sp.range);
  const currency = typeof sp.currency === "string" ? sp.currency : undefined;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { site } = context;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Recovery" art="stream" actions={<RangeSwitcher range={range} extraQuery={currency ? `&currency=${encodeURIComponent(currency)}` : ""} />}>
        How many failed payments come back and pay on <span className="font-mono text-zinc-300">{site.domain}</span>, and what they pay with
      </PageHeader>
      <Suspense key={`${range}:${currency}`} fallback={<TableCardSkeleton rows={6} cols={4} />}>
        <Body siteId={site.id} range={range} currency={currency} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, range, currency }: { siteId: string; range: RangeKey; currency: string | undefined }) {
  const { current } = paymentRanges(range);
  let data: Recovery;
  try {
    data = await cached(`q:v1:pay:rec:${siteId}:${current.from}:${current.to}`, TTL_SECONDS, () => getRecovery(siteId, current));
  } catch {
    return <Empty title="Recovery is temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>;
  }
  const currencies = [...new Set(data.rows.map((r) => r.currency))];
  if (currencies.length === 0) {
    return (
      <Empty icon={RotateCcw} title="No failed payments in this period" art="stream">
        Recovery is measured for payments that failed. There is nothing to recover yet.
      </Empty>
    );
  }
  const total = (c: string) => data.rows.filter((r) => r.currency === c).reduce((s, r) => s + r.valueMinor, 0);
  const cur = currency && currencies.includes(currency) ? currency : [...currencies].sort((a, b) => total(b) - total(a))[0]!;
  const rows = data.rows.filter((r) => r.currency === cur);
  const failed = rows.reduce((s, r) => s + r.failed, 0);
  const r24 = rows.reduce((s, r) => s + r.recovered24, 0);
  const r72 = rows.reduce((s, r) => s + r.recovered72, 0);
  const recoveredValue = rows.reduce((s, r) => s + r.recoveredValue72Minor, 0);
  const failedValue = rows.reduce((s, r) => s + r.valueMinor, 0);
  const through = data.through.filter((t) => t.currency === cur);
  const throughTotal = through.reduce((s, t) => s + t.count, 0) || 1;

  return (
    <>
      <div className="enter grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title="Failed payments" value={formatNumber(failed)} subtitle={`${formatMoney(failedValue, cur)} in ${cur}`} />
        <StatsCard title="Came back within 24 hours" value={formatPercent(rate(r24, failed) ?? 0)} subtitle={`${formatNumber(r24)} of ${formatNumber(failed)}`} />
        <StatsCard title="Came back within 72 hours" value={formatPercent(rate(r72, failed) ?? 0)} subtitle={`${formatNumber(r72)} of ${formatNumber(failed)}`} />
        <StatsCard title="Value recovered" value={formatMoney(recoveredValue, cur)} subtitle={failedValue > 0 ? `${formatPercent((recoveredValue / failedValue) * 100)} of what failed` : "Within 72 hours"} />
      </div>

      {currencies.length > 1 && <Segmented label="Currency" items={currencies.map((c) => ({ href: `?range=${range}&currency=${c}`, label: c, active: c === cur }))} />}

      <div className="enter grid gap-4 lg:grid-cols-5" style={{ ["--i" as string]: 2 }}>
        <Card className="overflow-hidden px-0 pb-0 lg:col-span-3">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>Recovery by cause</CardTitle>
            <CardDescription>The bar is the share that came back within 72 hours. Red means a cause that loses most of its customers.</CardDescription>
          </CardHeader>
          <RankedBars
            rows={[...rows]
              .sort((a, b) => b.valueMinor - a.valueMinor)
              .map((r) => {
                const pct = rate(r.recovered72, r.failed) ?? 0;
                return {
                  key: r.category,
                  label: CATEGORY_GUIDE[r.category as FailureCategory]?.label ?? r.category,
                  share: pct / 100,
                  value: formatPercent(pct),
                  meta: `${formatNumber(r.recovered72)} of ${formatNumber(r.failed)} · ${formatMoney(r.valueMinor, cur)} failed`,
                  bad: r.failed >= MIN_FAILED && pct < LOW_RECOVERY,
                };
              })}
          />
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="overflow-hidden px-0 pb-0">
            <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
              <CardTitle>They came back with</CardTitle>
              <CardDescription>The method of the payment that worked, which is often not the one that failed.</CardDescription>
            </CardHeader>
            {through.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-zinc-500">Nobody came back in this period.</p>
            ) : (
              <RankedBars
                rows={through.map((t, i) => ({ key: t.method, label: <span className="capitalize">{t.method}</span>, share: t.count / throughTotal, value: formatMoney(t.valueMinor, cur), meta: `${formatNumber(t.count)} payments`, emphasis: i === 0 }))}
              />
            )}
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Handing off to your own tools</CardTitle>
              <CardDescription>Each classified failure is also published as an event on the payments:failed stream (site, payment, order, cause, amount, customer reference), so your own mailer or WhatsApp sender can follow up. TrackMe sends no messages itself.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      <p className="text-xs leading-5 text-zinc-500">
        A failed payment counts as recovered when the same order, or the same identified customer, has a captured payment afterwards. Payments with neither an order id nor a customer
        reference cannot be followed, so they count as not recovered; link payments to sessions (Integrations) to make this number more complete.
      </p>
    </>
  );
}
