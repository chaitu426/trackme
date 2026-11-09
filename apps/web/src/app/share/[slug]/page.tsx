import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo-mark";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { GlyphField } from "@trackme/landing";
import { getPublicSite } from "@/lib/tenancy";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { parseRangeKey } from "@/lib/date-range";
import { PageHeader } from "@/components/ui/page-header";
import { RangeSwitcher } from "@/components/range-switcher";
import {
  ChartCardSkeleton,
  MapCardSkeleton,
  RankingCardSkeleton,
  Skeleton,
  StatsGridSkeleton,
} from "@/components/ui/skeleton";
import {
  OnlineNow,
  ShareDevices,
  ShareKpis,
  ShareLocations,
  ShareStrip,
  ShareTopPages,
  ShareTopSources,
  ShareTraffic,
} from "./sections";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await getPublicSite(slug);
  return {
    title: site ? `${site.domain} · Public analytics` : "Public analytics",
    description: site ? `Live, privacy-first traffic for ${site.domain}, shared read-only.` : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicShareDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range: rawRange } = await searchParams;
  // The one unauthenticated page that reads the database and ClickHouse: limit it per caller address.
  try {
    await checkRateLimit(`share:${getClientIp({ headers: (await headers()) as unknown as Headers })}`, 120, 60);
  } catch {
    notFound();
  }
  const site = await getPublicSite(slug);
  if (!site) notFound();
  const range = parseRangeKey(rawRange);

  const section = { workspaceId: site.workspaceId, siteId: site.id, range };

  return (
    <div className="min-h-screen bg-background text-zinc-100">
      <div className="border-b border-white/[0.08] bg-background">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-base font-medium leading-none text-zinc-50" aria-label="TrackMe home">
            <LogoMark />
            TrackMe
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden font-mono text-xs text-zinc-500 sm:inline">Public · read-only</span>
            <Link
              href="/signup"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.12] bg-raised px-3 text-xs text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:border-white/[0.24]"
            >
              Get your own <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title={site.domain}
          art="ridge"
          actions={
            <>
              <RangeSwitcher range={range} />
              <Suspense fallback={<Skeleton className="h-8 w-28 rounded-lg" />}>
                <OnlineNow siteId={site.id} />
              </Suspense>
            </>
          }
        >
          Live traffic, shared read-only. Counted without cookies or stored IP addresses.
        </PageHeader>

        <Suspense key={`kpi:${range}`} fallback={<StatsGridSkeleton count={4} />}>
          <ShareKpis {...section} />
        </Suspense>

        <Suspense key={`traffic:${range}`} fallback={<ChartCardSkeleton />}>
          <ShareTraffic {...section} />
        </Suspense>

        <Suspense key={`strip:${range}`} fallback={<StatsGridSkeleton count={3} className="grid grid-cols-3 gap-4" />}>
          <ShareStrip {...section} />
        </Suspense>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Suspense key={`pages:${range}`} fallback={<RankingCardSkeleton />}>
            <ShareTopPages {...section} />
          </Suspense>
          <Suspense key={`sources:${range}`} fallback={<RankingCardSkeleton />}>
            <ShareTopSources {...section} />
          </Suspense>
        </div>

        <Suspense key={`locations:${range}`} fallback={<MapCardSkeleton height={380} />}>
          <ShareLocations {...section} />
        </Suspense>

        <Suspense key={`devices:${range}`} fallback={<RankingCardSkeleton rows={6} />}>
          <ShareDevices {...section} />
        </Suspense>
      </main>

      <footer className="relative mt-16 overflow-hidden border-t border-white/[0.1] bg-sidebar">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 pt-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-zinc-400">
            Powered by <span className="text-zinc-100">TrackMe</span>, privacy-first web analytics.
          </p>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-300 transition-colors hover:text-white">
            See how it works <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="relative mt-8 h-[120px] sm:h-[170px]" aria-hidden="true">
          <GlyphField variant="text" text="TrackMe" cell={9} interactive />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-[#0f0f10] to-transparent" />
        </div>
      </footer>
    </div>
  );
}
