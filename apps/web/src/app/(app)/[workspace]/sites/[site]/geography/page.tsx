import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Globe2, X, Compass } from "lucide-react";
import { cachedBreakdown, cachedOverview } from "@/lib/cached-analytics";
import { GeoGlobe } from "@/components/geo-globe";
import { RangeSwitcher } from "@/components/range-switcher";
import { MapCardSkeleton, RankingCardSkeleton, StatsGridSkeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankingList } from "@/components/ui/ranking-list";
import { FlagImage } from "@/components/ui/flag-image";
import { StatsCard } from "@/components/ui/stats-card";
import { requireUser } from "@/lib/auth";
import { countryName } from "@/lib/countries";
import { parseRangeKey, percentChange, resolveDateRange, type RangeKey } from "@/lib/date-range";
import { formatChange, formatNumber, formatPercent } from "@/lib/format";
import { buildMetricRequest } from "@/lib/metrics";
import { sourceLabel } from "@/lib/channels";
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
  return (
    <div className="w-full space-y-5 text-left">
      <PageHeader title="Audience Geography" art="globe" actions={<RangeSwitcher range={range} extraQuery={selectedCountry ? `&country=${selectedCountry}` : ""} />}>
        Where visitors come from, by country, for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <Suspense key={`${range}:${selectedCountry ?? ""}`} fallback={<GeographySkeleton />}>
        <GeographyBody
          workspaceId={workspace.id}
          siteId={site.id}
          range={range}
          {...(selectedCountry ? { selectedCountry } : {})}
        />
      </Suspense>

      {/* Privacy note */}
      <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-zinc-400 text-left">
        <Compass className="mt-0.5 h-4 w-4 shrink-0 text-zinc-200" />
        <p className="leading-relaxed">
          Country is derived transiently from connection headers at the ingestion edge and stored only in aggregate. TrackMe never logs raw IP addresses or tracks precise visitor latitude/longitude coordinates.
        </p>
      </div>
    </div>
  );
}

function GeographySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
        <MapCardSkeleton />
        <RankingCardSkeleton rows={8} />
      </div>
      <StatsGridSkeleton count={3} className="grid grid-cols-1 gap-4 sm:grid-cols-3" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingCardSkeleton rows={6} />
        <RankingCardSkeleton rows={6} />
      </div>
    </div>
  );
}

async function GeographyBody({
  workspaceId,
  siteId,
  range,
  selectedCountry,
}: {
  workspaceId: string;
  siteId: string;
  range: RangeKey;
  selectedCountry?: string;
}) {
  const { current, previous } = resolveDateRange(range);
  const countryRequest = buildMetricRequest(workspaceId, siteId, current, { limit: 100 });
  const previousCountryRequest = buildMetricRequest(workspaceId, siteId, previous, { limit: 100 });
  const focusFilters = selectedCountry ? { country: selectedCountry } : undefined;
  const focusRequest = buildMetricRequest(workspaceId, siteId, current, {
    limit: 8,
    ...(focusFilters ? { filters: focusFilters } : {}),
  });

  const [countries, previousCountries, focusMetrics, topPages, topReferrers] = await Promise.all([
    cachedBreakdown(countryRequest, "country"),
    cachedBreakdown(previousCountryRequest, "country"),
    cachedOverview(focusRequest),
    cachedBreakdown(focusRequest, "path"),
    cachedBreakdown(focusRequest, "referrer"),
  ]);

  const countryItems = countries.items.filter((item) => /^[A-Z]{2}$/.test(item.name));
  const previousByCountry = new Map(previousCountries.items.map((item) => [item.name, item.visitors]));
  const focusedCountry = countryItems.find((item) => item.name === selectedCountry);
  const newMarkets = countryItems.filter((item) => item.visitors >= 3 && !previousByCountry.get(item.name));
  const audienceLabel = focusedCountry ? countryName(focusedCountry.name) : "Global Audience";

  return (
    <div className="space-y-5 reveal">
      {focusedCountry && (
        <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-card px-4 py-3 text-xs text-zinc-100">
          <span className="flex items-center gap-3 font-medium">
            <FlagImage code={focusedCountry.name} size={22} />
            <span>
              Filtering analytics strictly for <strong>{countryName(focusedCountry.name)}</strong>
            </span>
          </span>
          <Link
            href={`?range=${range}`}
            className="flex items-center gap-1 rounded-md border border-white/[0.14] bg-white/[0.07] px-2 py-1 font-medium text-zinc-100 transition hover:bg-white/[0.07]"
          >
            <X className="h-4 w-4" /> Clear Filter
          </Link>
        </div>
      )}

      {/* Map & Markets Grid: Upper-Left Anchored Headers */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.85fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b border-white/[0.06] pb-3 text-left">
            <div>
              <CardTitle>Visitor Globe</CardTitle>
              <CardDescription>
                {formatNumber(countries.total)} visitors across {formatNumber(countryItems.length)} countries
              </CardDescription>
            </div>
            <Globe2 className="h-4 w-4 text-zinc-200" />
          </CardHeader>
          <div className="pt-3">
            <GeoGlobe
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
            <span className="font-mono text-xs text-zinc-500 font-medium">
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            <span className="font-mono text-xs text-zinc-500 font-medium">
              Pageviews
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topPages.items.map((item) => ({
                name: item.name,
                value: item.pageviews,
                percentage: item.percentage,
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
            <span className="font-mono text-xs text-zinc-500 font-medium">
              Visitors
            </span>
          </CardHeader>
          <div className="pt-2">
            <RankingList
              items={topReferrers.items.map((item) => ({
                name: sourceLabel(item.name),
                value: item.visitors,
                percentage: item.percentage,
              }))}
              empty="No referrer data for this audience yet."
              valueFormatter={formatNumber}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
