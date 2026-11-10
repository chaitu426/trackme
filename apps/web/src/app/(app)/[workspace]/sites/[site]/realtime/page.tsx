import { notFound } from "next/navigation";
import { getRecentEvents } from "@trackme/analytics";
import { RealtimeLive } from "@/components/realtime-live";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { getRealtimeSnapshot } from "@/lib/realtime";

export default async function SiteRealtimeReport({
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

  const [snapshot, recentEvents] = await Promise.all([
    getRealtimeSnapshot(site.id),
    getRecentEvents(workspace.id, site.id, 20),
  ]);

  return (
    <div className="w-full space-y-4">
      <RealtimeLive siteId={site.id} initial={snapshot} initialEvents={recentEvents} />
    </div>
  );
}
