import { notFound } from "next/navigation";
import { db, siteFunnels, eq, desc } from "@trackme/db";
import { analyzeFunnel, type FunnelStepDefinition, type FunnelAnalysisResult } from "@trackme/analytics";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { FunnelsClient, type FunnelItem } from "./funnels-client";

export default async function SiteFunnelsPage({
  params,
}: {
  params: Promise<{ workspace: string; site: string }>;
}) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

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

  if (activeFunnel && activeFunnel.steps.length > 0) {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    initialAnalysis = await analyzeFunnel(
      {
        workspaceId: workspace.id,
        siteId: site.id,
        dateRange: {
          from: thirtyDaysAgo.toISOString(),
          to: now.toISOString(),
          granularity: "day",
        },
      },
      activeFunnel.steps
    );
  }

  return (
    <FunnelsClient
      site={{ id: site.id, domain: site.domain }}
      initialFunnels={initialFunnels}
      initialActiveFunnel={activeFunnel}
      initialAnalysis={initialAnalysis}
    />
  );
}
