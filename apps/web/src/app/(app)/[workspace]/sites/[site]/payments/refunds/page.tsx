import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { daysUntil, getRefundsAndDisputes, type RefundDisputeRow, type RefundsAndDisputes } from "@trackme/analytics";
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
import { formatNumber, formatPercent, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TTL_SECONDS = 120;
/** A dispute due within this many days is flagged as urgent. */
const URGENT_DAYS = 3;

const words = (code: string) => code.replaceAll("_", " ");

export default async function RefundsPage({ params, searchParams }: { params: Promise<{ workspace: string; site: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const { workspace, site } = context;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Refunds & Disputes" art="pulse" actions={<RangeSwitcher range={range} extraQuery={currency ? `&currency=${encodeURIComponent(currency)}` : ""} />}>
        Money that went back to customers or was challenged on <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>
      <Suspense key={`${range}:${currency}`} fallback={<TableCardSkeleton rows={6} cols={4} />}>
        <Body siteId={site.id} base={`/${workspace.slug}/sites/${site.domain}`} range={range} currency={currency} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, base, range, currency }: { siteId: string; base: string; range: RangeKey; currency: string | undefined }) {
  const { current } = paymentRanges(range);
  let data: RefundsAndDisputes;
  try {
    data = await cached(`q:v1:pay:rd:${siteId}:${current.from}:${current.to}`, TTL_SECONDS, () => getRefundsAndDisputes(siteId, current));
  } catch {
    return <Empty title="Refunds and disputes are temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>;
  }
  const withActivity = data.summary.filter((s) => s.refundedCount + s.disputedCount > 0);
  if (data.summary.length === 0 || withActivity.length === 0) {
    return (
      <Empty icon={Undo2} title="No refunds or disputes in this period" art="pulse">
        They appear here as your gateway reports them.
      </Empty>
    );
  }
  const cur = currency && withActivity.some((s) => s.currency === currency) ? currency : [...withActivity].sort((a, b) => b.refundedMinor + b.disputedMinor - (a.refundedMinor + a.disputedMinor))[0]!.currency;
  const s = data.summary.find((x) => x.currency === cur)!;
  const rows = data.rows.filter((r) => r.currency === cur);
  const open = rows
    .filter((r) => r.kind === "disputed" && r.dueBy)
    .map((r) => ({ row: r, days: daysUntil(r.dueBy) as number }))
    .sort((a, b) => a.days - b.days);
  const reasons = data.reasons;

  return (
    <>
      <div className="enter grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title="Refunded" value={formatMoney(s.refundedMinor, cur)} subtitle={`${formatNumber(s.refundedCount)} refunds`} />
        <StatsCard title="Refund rate" value={formatPercent(rate(s.refundedMinor, s.capturedMinor) ?? 0)} subtitle="Of value captured in the period" />
        <StatsCard title="Disputed" value={formatMoney(s.disputedMinor, cur)} subtitle={`${formatNumber(s.disputedCount)} disputes`} />
        <StatsCard title="Dispute rate" value={formatPercent(rate(s.disputedCount, s.capturedCount) ?? 0)} subtitle="Of payments captured in the period" />
      </div>

      {withActivity.length > 1 && <Segmented label="Currency" items={withActivity.map((x) => ({ href: `?range=${range}&currency=${x.currency}`, label: x.currency, active: x.currency === cur }))} />}

      <div className="enter grid gap-4 lg:grid-cols-5" style={{ ["--i" as string]: 2 }}>
        <Card className="overflow-hidden px-0 pb-0 lg:col-span-3">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>Disputes to answer</CardTitle>
            <CardDescription>Soonest deadline first. A dispute left unanswered is lost.</CardDescription>
          </CardHeader>
          {open.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-zinc-500">No disputes with a deadline in this period.</p>
          ) : (
            <ul>
              {open.map(({ row, days }) => (
                <li key={row.paymentId} className="flex items-center justify-between gap-4 border-t border-white/[0.04] px-5 py-3 first:border-t-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm capitalize text-zinc-200">{words(row.reason) || "No reason given"}</p>
                    <p className="truncate font-mono text-xs text-zinc-500">
                      {row.orderId || row.paymentId} · {row.gateway}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm tabular-nums text-zinc-50">{formatMoney(row.amountMinor, row.currency)}</p>
                    <p className={cn("text-xs", days < 0 ? "text-[#e5484d]" : days <= URGENT_DAYS ? "text-amber-400" : "text-zinc-500")}>
                      {days < 0 ? `${-days} ${-days === 1 ? "day" : "days"} overdue` : days === 0 ? "Due today" : `${days} ${days === 1 ? "day" : "days"} left`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden px-0 pb-0 lg:col-span-2">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>Reasons</CardTitle>
            <CardDescription>As the gateway reports them</CardDescription>
          </CardHeader>
          {reasons.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-zinc-500">No reasons recorded.</p>
          ) : (
            <RankedBars
              rows={reasons.map((r, i) => ({
                key: `${r.kind}:${r.reason}`,
                label: <span className="capitalize">{words(r.reason)}</span>,
                share: r.count / Math.max(...reasons.map((x) => x.count), 1),
                value: formatNumber(r.count),
                meta: r.kind === "disputed" ? "Dispute" : "Refund",
                bad: r.kind === "disputed" && i < 3,
              }))}
            />
          )}
        </Card>
      </div>

      <Card className="enter overflow-hidden px-0 pb-0">
        <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
          <CardTitle>All refunds and disputes</CardTitle>
          <CardDescription>Newest first, up to 100</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-2 text-left font-normal">When</th>
                <th className="px-2 py-2 text-left font-normal">Kind</th>
                <th className="px-2 py-2 text-left font-normal">Reason</th>
                <th className="px-2 py-2 text-left font-normal">Method</th>
                <th className="px-2 py-2 text-right font-normal">Amount</th>
                <th className="px-5 py-2 text-right font-normal">Customer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: RefundDisputeRow) => (
                <tr key={`${r.kind}:${r.paymentId}:${r.at}`} className="border-t border-white/[0.04]">
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs text-zinc-400">{formatRelativeTime(r.at)}</td>
                  <td className={cn("px-2 py-2.5 text-xs", r.kind === "disputed" ? "text-amber-400" : "text-zinc-300")}>{r.kind === "disputed" ? "Dispute" : "Refund"}</td>
                  <td className="px-2 py-2.5 text-xs capitalize text-zinc-400">{words(r.reason)}</td>
                  <td className="px-2 py-2.5 text-xs capitalize text-zinc-400">
                    {r.method} · {r.gateway}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-zinc-50">{formatMoney(r.amountMinor, r.currency)}</td>
                  <td className="px-5 py-2.5 text-right text-xs">
                    {r.userRef ? (
                      <Link className="font-mono text-zinc-300 underline-offset-4 hover:underline" href={`${base}/people?q=${encodeURIComponent(r.userRef)}`}>
                        {r.userRef.length > 18 ? `${r.userRef.slice(0, 16)}…` : r.userRef}
                      </Link>
                    ) : (
                      <span className="text-zinc-600">Not linked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs leading-5 text-zinc-500">
        A dispute deadline appears only when the gateway sends one with the dispute. Rates are against payments captured in the same period, so a refund of an older payment still counts here.
      </p>
    </>
  );
}
