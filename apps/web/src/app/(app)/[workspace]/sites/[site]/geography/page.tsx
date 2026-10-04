import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Globe2, X, Compass } from "lucide-react";
import { getBreakdown, getOverviewMetrics } from "@trackme/analytics";
import { AudienceMap } from "@/components/audience-map";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { FlagImage } from "@/components/ui/flag-image";
import { StatsCard } from "@/components/ui/stats-card";
import { requireUser } from "@/lib/auth";
import { countryName } from "@/lib/countries";
import { parseRangeKey, percentChange, RANGE_OPTIONS, resolveDateRange } from "@/lib/date-range";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { buildMetricRequest } from "@/lib/metrics";
import { requireDashboardSite } from "@/lib/tenancy";

export default async function AudienceGeographyPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<{ range?: string; country?: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const { range: rawRange, country: rawCountry } = await searchParams;
  const range = parseRangeKey(rawRange);
  const selectedCountry = /^[A-Z]{2}$/.test(rawCountry ?? "") ? rawCountry : undefined;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;
  const { current, previous } = resolveDateRange(range);
  const countryRequest = buildMetricRequest(workspace.id, site.id, current, { limit: 100 });
  const previousCountryRequest = buildMetricRequest(workspace.id, site.id, previous, { limit: 100 });
  const focusFilters = selectedCountry ? { country: selectedCountry } : undefined;
  const focusRequest = buildMetricRequest(workspace.id, site.id, current, {
    limit: 8,
    ...(focusFilters ? { filters: focusFilters } : {}),
  });

  const [countries, previousCountries, focusMetrics, topPages, topReferrers] = await Promise.all([
    getBreakdown(countryRequest, "country"),
    getBreakdown(previousCountryRequest, "country"),
    getOverviewMetrics(focusRequest),
    getBreakdown(focusRequest, "path"),
    getBreakdown(focusRequest, "referrer"),
  ]);

  const countryItems = countries.items.filter((item) => /^[A-Z]{2}$/.test(item.name));
  const previousByCountry = new Map(previousCountries.items.map((item) => [item.name, item.visitors]));
  const focusedCountry = countryItems.find((item) => item.name === selectedCountry);
  const newMarkets = countryItems.filter((item) => item.visitors >= 3 && !previousByCountry.get(item.name));
  const audienceLabel = focusedCountry ? countryName(focusedCountry.name) : "Global Audience";

  return (
    <div className="w-full space-y-5 text-left">
      {/* ── Top Header: Strictly Left-Anchored ── */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-zinc-50">Audience Geography</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400">
              <Globe2 className="h-3 w-3" />
              Country-level
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Regional distribution and international traffic breakdown for{" "}
            <span className="font-mono font-medium text-zinc-300">{site.domain}</span>
          </p>
        </div>

        <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-xs font-medium text-zinc-400 gap-0.5">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.key}
              href={`?range=${option.key}${selectedCountry ? `&country=${selectedCountry}` : ""}`}
              className={`rounded-[5px] px-3 py-1.5 transition-colors font-medium ${option.key === range
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "hover:bg-white/[0.04] hover:text-zinc-300 text-zinc-500"
                }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {focusedCountry && (
        <div className="flex items-center justify-between rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-200">
          <span className="flex items-center gap-2.5 font-medium">
            <FlagImage code={focusedCountry.name} size={22} />
            <span>
              Filtering analytics strictly for <strong>{countryName(focusedCountry.name)}</strong>
            </span>
          </span>
          <Link
            href={`?range=${range}`}
            className="flex items-center gap-1 rounded-md border border-blue-400/20 bg-blue-400/10 px-2 py-1 font-semibold text-blue-200 transition hover:bg-blue-400/20"
          >
            <X className="h-3.5 w-3.5" /> Clear Filter
          </Link>
        </div>
      )}

      {/* Map & Markets Grid: Upper-Left Anchored Headers */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Visitor Distribution Map</CardTitle>
              <CardDescription>
                {formatNumber(countries.total)} visitors across {formatNumber(countryItems.length)} countries
              </CardDescription>
            </div>
            <Globe2 className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <div className="pt-3">
            <AudienceMap
              countries={countryItems}
              {...(selectedCountry ? { selectedCountry } : {})}
              range={range}
            />
          </div>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top Regional Markets</CardTitle>
              <CardDescription>Ranked by unique visitor count</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Visitors · % Share
            </span>
          </CardHeader>
          <div className="pt-2">
            {countryItems.length === 0 ? (
              <p className="py-12 text-center text-xs text-zinc-500">
                Location data will appear after your first visitors arrive.
              </p>
            ) : (
              <RankingList
                items={countryItems.slice(0, 8).map((country) => {
                  const change = percentChange(country.visitors, previousByCountry.get(country.name) ?? 0);
                  return {
                    name: countryName(country.name),
                    value: country.visitors,
                    percentage: country.percentage,
                    icon: <FlagImage code={country.name} size={18} />,
                    meta:
                      change !== null
                        ? `${formatPercent(country.percentage)} · ${formatChange(change)}`
                        : formatPercent(country.percentage),
                    href: `?range=${range}&country=${country.name}`,
                  };
                })}
                valueFormatter={formatNumber}
              />
            )}
          </div>
        </Card>
      </div>

      {/* Focus Stats Cards: Left-Anchored Headings */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <StatsCard
          title={audienceLabel}
          value={formatNumber(focusMetrics.visitors)}
          subtitle="Unique visitors in selected timeframe"
        />
        <StatsCard
          title="Audience Engagement"
          value={formatNumber(focusMetrics.pageviews)}
          subtitle={`Pageviews from ${focusedCountry ? countryName(focusedCountry.name) : "all markets"}`}
        />
        <StatsCard
          title="New Growth Markets"
          value={formatNumber(newMarkets.length)}
          subtitle="Countries with 3+ visitors and no prior traffic"
        />
      </div>

      {/* Popular Pages & Top Sources */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Popular Pages for Region</CardTitle>
              <CardDescription>Most visited paths by this audience</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Pageviews
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topPages.items.map((item) => ({
                name: item.name,
                value: item.pageviews,
                percentage: item.percentage,
                icon: <FileText className="h-3.5 w-3.5 text-blue-400" />,
              }))}
              empty="No page data for this audience yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Top Inbound Sources</CardTitle>
              <CardDescription>Referrers directing this geographic audience</CardDescription>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Visitors
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topReferrers.items.map((item) => ({
                name: item.name === "(direct / none)" ? "Direct / None" : item.name || "Direct / None",
                value: item.visitors,
                percentage: item.percentage,
                icon: <Globe2 className="h-3.5 w-3.5 text-blue-400" />,
              }))}
              empty="No referrer data for this audience yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
      </div>

      {/* Privacy note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-zinc-400 text-left">
        <Compass className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <p className="leading-relaxed">
          Country is derived transiently from connection headers at the ingestion edge and stored only in aggregate. TrackMe never logs raw IP addresses or tracks precise visitor latitude/longitude coordinates.
        </p>
      </div>
    </div>
  );
}
