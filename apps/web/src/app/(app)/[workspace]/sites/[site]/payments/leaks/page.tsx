import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Download, Droplets } from "lucide-react";
import { getRevenueLeaks, MIN_AFFECTED, type LeakIssue, type RevenueLeaks } from "@trackme/analytics";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/ui/stats-card";
import { TableCardSkeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";
import { RangeSwitcher } from "@/components/range-switcher";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { cached } from "@/lib/query-cache";
import { parseRangeKey, type RangeKey } from "@/lib/date-range";
import { formatMoney, paymentRanges, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const TTL_SECONDS = 300;
const CONFIDENCE: Record<LeakIssue["confidence"], string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

export default async function RevenueLeaksPage({ params, searchParams }: { params: Promise<{ workspace: string; site: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const range = parseRangeKey((await searchParams).range);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader
        title="Revenue Leaks"
        art="ridge"
        actions={
          <>
            <RangeSwitcher range={range} />
            <a href={`/api/v1/sites/${site.id}/revenue-leaks.csv?range=${range}`} className={cn(buttonBase, buttonVariants.outline, buttonSizes.sm)}>
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </>
        }
      >
        Which errors cost you checkouts on <span className="font-mono text-zinc-300">{site.domain}</span>, in money, biggest first
      </PageHeader>
      <Suspense key={range} fallback={<TableCardSkeleton rows={6} cols={4} />}>
        <Body siteId={site.id} base={`/${workspace.slug}/sites/${site.domain}`} range={range} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, base, range }: { siteId: string; base: string; range: RangeKey }) {
  const { current } = paymentRanges(range);
  let data: RevenueLeaks;
  try {
    data = await cached(`q:v1:pay:leaks:${siteId}:${current.from}:${current.to}`, TTL_SECONDS, () => getRevenueLeaks(siteId, current));
  } catch {
    return <Empty title="Revenue Leaks is temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>;
  }
  if (data.sessions === 0) {
    return (
      <Empty icon={Droplets} title="No checkout sessions in this period" art="ridge">
        This page needs visitors who open your checkout page. It fills in as they do, and is rebuilt every hour.
      </Empty>
    );
  }
  const money = (minor: number) => formatMoney(minor, data.currency || "INR");
  const published = data.issues.filter((i) => i.enough);
  const collecting = data.issues.filter((i) => !i.enough);

  return (
    <>
      <div className="enter grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title="Checkout sessions" value={formatNumber(data.sessions)} subtitle={`${formatNumber(data.paid)} paid`} />
        <StatsCard title="Conversion" value={formatPercent(data.conversion * 100)} subtitle="Opened checkout and paid" />
        <StatsCard title="Saw an error" value={formatPercent(rate(data.sessionsWithErrors, data.sessions) ?? 0)} subtitle={`${formatNumber(data.sessionsWithErrors)} sessions`} />
        <StatsCard title="Average order" value={data.aovMinor > 0 ? money(data.aovMinor) : "–"} subtitle="Used to value a lost sale" />
      </div>

      <Card className="enter overflow-hidden px-0 pb-0">
        <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
          <CardTitle>Fix this first</CardTitle>
          <CardDescription>Errors seen in a checkout session, ranked by estimated cost. Both figures are estimates; the second is the more careful one.</CardDescription>
        </CardHeader>
        {published.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs leading-5 text-zinc-500">
            No error has enough checkout sessions yet to put a figure on it (at least {MIN_AFFECTED} sessions that saw it, and enough others to compare with).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2 text-left font-normal">Error</th>
                  <th className="px-2 py-2 text-right font-normal">Sessions</th>
                  <th className="px-2 py-2 text-right font-normal">Paid with it / without</th>
                  <th className="px-2 py-2 text-right font-normal">Up to</th>
                  <th className="px-5 py-2 text-right font-normal">Beyond normal drop-off</th>
                </tr>
              </thead>
              <tbody>
                {published.map((i, rank) => (
                  <tr key={i.groupId} className="border-t border-white/[0.04] align-top">
                    <td className="max-w-[360px] px-5 py-3">
                      <Link href={`${base}/errors/${i.groupId}`} className="line-clamp-2 text-zinc-100 hover:underline hover:underline-offset-4">
                        {rank === 0 && <span className="mr-2 rounded bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-zinc-300">First</span>}
                        {i.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {i.etype ? `${i.etype} · ` : ""}
                        {CONFIDENCE[i.confidence]}
                      </p>
                    </td>
                    <td className="px-2 py-3 text-right font-mono tabular-nums text-zinc-300">{formatNumber(i.affected)}</td>
                    <td className="px-2 py-3 text-right font-mono text-xs tabular-nums text-zinc-400">
                      <span className="text-bad">{formatPercent(i.affectedConversion * 100)}</span> / {formatPercent(i.controlConversion * 100)}
                    </td>
                    <td className="px-2 py-3 text-right font-mono tabular-nums text-zinc-300">{money(i.associatedLossMinor ?? 0)}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-zinc-50">{i.incrementalLossMinor ? money(i.incrementalLossMinor) : "None found"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {collecting.length > 0 && (
          <div className="border-t border-white/[0.06] px-5 py-3">
            <p className="text-xs font-medium text-zinc-400">Still collecting data</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {collecting.slice(0, 8).map((i) => (
                <li key={i.groupId} className="flex items-baseline justify-between gap-4 text-xs">
                  <Link href={`${base}/errors/${i.groupId}`} className="min-w-0 truncate text-zinc-300 hover:underline hover:underline-offset-4">
                    {i.title}
                  </Link>
                  <span className="shrink-0 font-mono tabular-nums text-zinc-500">
                    {i.affected} of {MIN_AFFECTED} sessions
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="enter">
        <CardHeader className="pb-2">
          <CardTitle>How these numbers are made</CardTitle>
        </CardHeader>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-xs leading-5 text-zinc-400 marker:text-zinc-600">
          <li>A checkout session is a visit that opened your checkout page. An error counts for it if it happened in that session from ten minutes before the page opened.</li>
          <li>
            <span className="text-zinc-200">Up to</span> is the sessions that saw the error and did not pay, times the average order value. It is an upper bound: some of them would not have paid anyway.
          </li>
          <li>
            <span className="text-zinc-200">Beyond normal drop-off</span> compares those sessions with the sessions that did not see the error. If they paid at the same rate, nothing is attributed to the error.
            Otherwise it is the gap in conversion, times the sessions, times the average order value.
          </li>
          <li>A figure is published only with at least {MIN_AFFECTED} sessions that saw the error and enough others to compare with. Confidence reflects how unlikely the gap is to be chance.</li>
          <li>Money is valued in {data.currency || "the main currency"} using the average order value; order amounts are not known for sessions that did not pay, so this is always an estimate. Rebuilt every hour from sessions, errors and payments.</li>
        </ul>
      </Card>
    </>
  );
}
