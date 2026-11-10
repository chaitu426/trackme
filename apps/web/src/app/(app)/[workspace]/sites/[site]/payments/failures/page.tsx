import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { Stethoscope } from "lucide-react";
import { CATEGORY_GUIDE, FAILURE_CATEGORIES, type FailureCategory } from "@trackme/payments";
import { getFailureOverview, listFailures, type FailureOverview, type FailureList } from "@trackme/analytics";
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
import { fillDays, formatMoney, paymentRanges, rate } from "@/lib/payments-view";
import { formatNumber, formatPercent, formatRelativeTime } from "@/lib/format";

const TTL_SECONDS = 120;
/** Below this share explained, the classifier is missing too much to trust the picture. */
const MIN_COVERAGE = 80;

const isCategory = (v: string | undefined): v is FailureCategory => Boolean(v) && (FAILURE_CATEGORIES as readonly string[]).includes(v!);

export default async function FailureDoctorPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const range = parseRangeKey(sp.range);
  const category = isCategory(one("category")) ? (one("category") as FailureCategory) : undefined;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const base = `/${workspace.slug}/sites/${site.domain}`;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader title="Failure Doctor" art="steps" actions={<RangeSwitcher range={range} extraQuery={`${one("currency") ? `&currency=${encodeURIComponent(one("currency")!)}` : ""}${category ? `&category=${category}` : ""}`} />}>
        Why payments fail on <span className="font-mono text-zinc-300">{site.domain}</span>, in plain words, with what to do about each cause
      </PageHeader>
      <Suspense key={`${range}:${one("currency")}:${category}:${one("cursor")}`} fallback={<TableCardSkeleton rows={6} cols={4} />}>
        <Body siteId={site.id} base={base} range={range} currency={one("currency")} category={category} cursor={one("cursor")} />
      </Suspense>
    </div>
  );
}

async function Body({ siteId, base, range, currency, category, cursor }: { siteId: string; base: string; range: RangeKey; currency: string | undefined; category: FailureCategory | undefined; cursor: string | undefined }) {
  const { current } = paymentRanges(range);
  let overview: FailureOverview;
  try {
    overview = await cached(`q:v1:pay:fd:${siteId}:${current.from}:${current.to}`, TTL_SECONDS, () => getFailureOverview(siteId, current));
  } catch {
    return <Empty title="The Failure Doctor is temporarily unavailable">Nothing is lost. Reload in a moment.</Empty>;
  }

  const currencies = [...new Set(overview.categories.map((c) => c.currency))];
  if (currencies.length === 0) {
    return (
      <Empty icon={Stethoscope} title="No failed payments in this period" art="steps">
        Failures are classified about a minute after they happen. Nothing is failing, or no gateway is connected yet.
      </Empty>
    );
  }
  const totals = new Map(currencies.map((c) => [c, overview.categories.filter((r) => r.currency === c).reduce((s, r) => s + r.valueMinor, 0)]));
  const cur = currency && currencies.includes(currency) ? currency : [...currencies].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))[0]!;

  const rows = overview.categories.filter((r) => r.currency === cur).sort((a, b) => b.valueMinor - a.valueMinor);
  const count = rows.reduce((s, r) => s + r.count, 0);
  const value = rows.reduce((s, r) => s + r.valueMinor, 0);
  const coverage = rate(overview.classified - overview.unknown, overview.classified);
  const yours = rows.filter((r) => CATEGORY_GUIDE[r.category as FailureCategory]?.fixable === "you").reduce((s, r) => s + r.count, 0);
  const selected = category && rows.some((r) => r.category === category) ? category : (rows[0]?.category as FailureCategory | undefined);
  const guide = selected ? CATEGORY_GUIDE[selected] : undefined;
  const selectedRow = rows.find((r) => r.category === selected);

  const link = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ range, currency: cur });
    if (category) q.set("category", category);
    for (const [k, v] of Object.entries(over)) v === undefined ? q.delete(k) : q.set(k, v);
    return `?${q}`;
  };

  let list: FailureList = { rows: [], next: null };
  try {
    list = await listFailures(siteId, current, { currency: cur, ...(category ? { category } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
  } catch {
    list = { rows: [], next: null };
  }

  const days = fillDays(
    overview.daily.map((d) => ({ day: d.day, currency: d.currency, revenueMinor: d.valueMinor, paid: d.count, attempts: d.count })),
    cur,
    current.from,
    current.to
  ).map((d) => ({ day: d.day, revenueMinor: d.revenueMinor, paid: d.paid }));
  const codes = overview.codes.filter((c) => c.category === selected);

  return (
    <>
      <div className="enter grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard title="Failed payments" value={formatNumber(count)} subtitle={currencies.length > 1 ? `In ${cur}` : "In this period"} />
        <StatsCard title="Value that failed" value={formatMoney(value, cur)} subtitle="Before any retry that worked" />
        <StatsCard title="Explained by a rule" value={coverage === null ? "–" : formatPercent(coverage)} subtitle={coverage !== null && coverage < MIN_COVERAGE ? "Low: add rules for the codes below" : "Share not left as unknown"} />
        <StatsCard title="Yours to fix" value={formatPercent(rate(yours, count) ?? 0)} subtitle="Checkout, UPI flow, your errors" />
      </div>

      {currencies.length > 1 && (
        <Segmented label="Currency" items={currencies.map((c) => ({ href: link({ currency: c, category: undefined, cursor: undefined }), label: c, active: c === cur }))} />
      )}

      <div className="enter grid gap-4 lg:grid-cols-5" style={{ ["--i" as string]: 2 }}>
        <Card className="overflow-hidden px-0 pb-0 lg:col-span-3">
          <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
            <CardTitle>Why they failed</CardTitle>
            <CardDescription>Biggest cause first, by value. Choose a cause to see what to do and the payments behind it.</CardDescription>
          </CardHeader>
          <RankedBars
            rows={rows.map((r, i) => {
              const g = CATEGORY_GUIDE[r.category as FailureCategory];
              return {
                key: r.category,
                label: g?.label ?? r.category,
                share: value > 0 ? r.valueMinor / value : 0,
                value: formatMoney(r.valueMinor, cur),
                meta: `${formatNumber(r.count)} ${r.count === 1 ? "payment" : "payments"}${r.withSessionError > 0 ? ` · ${r.withSessionError} saw an error` : ""}`,
                emphasis: i === 0,
                bad: r.category === "unknown" || r.category === "app_bug",
                href: link({ category: r.category, cursor: undefined }),
                selected: r.category === selected,
              };
            })}
          />
        </Card>

        {guide && selected && selectedRow && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle>{guide.label}</CardTitle>
              <CardDescription>{guide.meaning}</CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-400">What to do</p>
                <p className="mt-1 text-sm leading-6 text-zinc-200">{guide.action}</p>
              </div>
              {selectedRow.withSessionError > 0 && (
                <p className="rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-xs leading-5 text-zinc-400">
                  {selectedRow.withSessionError} of {selectedRow.count} also had an error in the same session just before. See{" "}
                  <Link className="text-zinc-200 underline underline-offset-4" href={`${base}/errors`}>
                    Error Tracking
                  </Link>
                  .
                </p>
              )}
              {codes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-400">Top codes from the gateway</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {codes.map((c) => (
                      <li key={c.code} className="flex items-baseline justify-between gap-3 text-xs">
                        <code className="min-w-0 truncate rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-zinc-300">{c.code}</code>
                        <span className="shrink-0 font-mono tabular-nums text-zinc-400">{formatNumber(c.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <Card className="enter overflow-hidden px-0 pb-0">
        <CardHeader className="px-5 pb-2">
          <CardTitle>Failed value per day</CardTitle>
          <CardDescription>All causes together, in {cur}, by the day the payment failed (UTC)</CardDescription>
        </CardHeader>
        <RevenueChart points={days} previous={[]} currency={cur} label="Failed value per day" unit="failure" />
      </Card>

      <Card className="enter overflow-hidden px-0 pb-0">
        <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] px-5 pb-3">
          <div>
            <CardTitle>Failed payments{category ? `: ${CATEGORY_GUIDE[category].label}` : ""}</CardTitle>
            <CardDescription>Newest first</CardDescription>
          </div>
          {category && (
            <Link href={link({ category: undefined, cursor: undefined })} className="press text-xs text-zinc-400 hover:text-zinc-100">
              Show all causes
            </Link>
          )}
        </CardHeader>
        {list.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs text-zinc-500">No failed payments here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2 text-left font-normal">When</th>
                  <th className="px-2 py-2 text-left font-normal">Why</th>
                  <th className="px-2 py-2 text-left font-normal">Method</th>
                  <th className="px-2 py-2 text-right font-normal">Amount</th>
                  <th className="px-5 py-2 text-right font-normal">Customer</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.paymentId} className="border-t border-white/[0.04] align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-zinc-400">{formatRelativeTime(r.failedAt)}</td>
                    <td className="max-w-[360px] px-2 py-2.5">
                      <p className="text-zinc-200">{CATEGORY_GUIDE[r.category as FailureCategory]?.label ?? r.category}</p>
                      <p className="truncate font-mono text-xs text-zinc-500" title={r.code}>
                        {r.code || "(no code)"} · {r.ruleId}
                        {r.sessionError ? " · error in session" : ""}
                      </p>
                    </td>
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
        )}
        {list.next && (
          <div className="border-t border-white/[0.06] px-5 py-3 text-right">
            <Link href={link({ cursor: list.next })} scroll={false} className="press text-xs text-zinc-300 hover:text-zinc-50">
              Older failures
            </Link>
          </div>
        )}
      </Card>

      <p className="text-xs leading-5 text-zinc-500">
        Each failure is sorted by rules that read the gateway&apos;s own code first, then the context: an error in the same session in the two minutes before, the gateway&apos;s
        success rate at the time, and how long the attempt took. The rule that decided each one is shown beside it.
      </p>
    </>
  );
}
