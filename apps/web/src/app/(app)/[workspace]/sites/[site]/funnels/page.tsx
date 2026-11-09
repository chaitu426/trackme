import { notFound } from "next/navigation";
import { db, siteFunnels, eq, desc } from "@trackme/db";
import { cachedFunnel } from "@/lib/query-cache";
import { cachedBreakdown } from "@/lib/cached-analytics";
import { buildMetricRequest } from "@/lib/metrics";
import { resolveDateRange } from "@/lib/date-range";
import { analyzeFunnel, getCustomEventsSummary, type FunnelStepDefinition, type FunnelAnalysisResult } from "@trackme/analytics";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { FunnelsClient, type FunnelItem, type FunnelSuggestions } from "./funnels-client";

/** Pages and events seen in the last 30 days, to autocomplete step targets. Never rejects. */
async function loadSuggestions(workspaceId: string, siteId: string): Promise<FunnelSuggestions> {
  try {
    const request = buildMetricRequest(workspaceId, siteId, resolveDateRange("30d").current, { limit: 50 });
    const [paths, events] = await Promise.all([cachedBreakdown(request, "path"), getCustomEventsSummary(request)]);
    return { paths: paths.items.map((i) => i.name), events: events.map((e) => e.eventName) };
  } catch {
    return { paths: [], events: [] };
  }
}

export default async function SiteFunnelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; site: string }>;
  searchParams: Promise<{ path?: string | string[] }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;
  const { path: rawPaths } = await searchParams;
  // Paths handed over by the Journeys page ("Turn into a funnel"). Page paths only, bounded.
  const prefillPaths = (Array.isArray(rawPaths) ? rawPaths : rawPaths ? [rawPaths] : [])
    .filter((p) => p.startsWith("/") && p.length <= 512)
    .slice(0, 8);

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  // Started now, awaited by nobody here: it streams to the create dialog when it resolves.
  const suggestions = loadSuggestions(workspace.id, site.id);

  // Load existing funnels from Postgres
  const funnelRows = await db
    .select()
    .from(siteFunnels)
    .where(eq(siteFunnels.siteId, site.id))
    .orderBy(desc(siteFunnels.createdAt));

  const initialFunnels: FunnelItem[] = funnelRows.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    steps: (f.steps as unknown as FunnelStepDefinition[]) || [],
    createdAt: f.createdAt.toISOString(),
  }));

  const activeFunnel = initialFunnels[0] || null;
  let initialAnalysis: FunnelAnalysisResult | null = null;
  let initialAnalysisError: string | null = null;

  if (activeFunnel && activeFunnel.steps.length > 0) {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    try {
      initialAnalysis = await cachedFunnel(
        {
          workspaceId: workspace.id,
          siteId: site.id,
          dateRange: {
            from: thirtyDaysAgo.toISOString(),
            to: now.toISOString(),
            granularity: "day",
          },
        },
        activeFunnel.steps,
        86400,
        (normalized) => analyzeFunnel(normalized, activeFunnel.steps)
      );
    } catch {
      initialAnalysisError = "Analytics is temporarily unavailable. Retry in a moment.";
    }
  }

  return (
    <FunnelsClient
      site={{ id: site.id, domain: site.domain }}
      initialFunnels={initialFunnels}
      initialActiveFunnel={activeFunnel}
      initialAnalysis={initialAnalysis}
      initialAnalysisError={initialAnalysisError}
      suggestions={suggestions}
      prefillPaths={prefillPaths}
    />
  );
}
