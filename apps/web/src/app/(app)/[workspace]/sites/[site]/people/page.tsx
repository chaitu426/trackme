import { notFound } from "next/navigation";
import { listProfiles, profileStats } from "@trackme/analytics";
import { overlayServerProfiles } from "@/lib/profiles";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { PeopleClient, type UserProfileItem } from "./people-client";

export default async function SitePeoplePage({
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
  const { site } = context;

  // Identified people come from the event stream (ClickHouse); a backend's POST /people adds name/email on top.
  const [page, stats] = await Promise.all([
    listProfiles({ workspaceId: site.workspaceId, siteId: site.id, limit: 50, offset: 0 }),
    profileStats(site.workspaceId, site.id),
  ]);
  const initialProfiles: UserProfileItem[] = (await overlayServerProfiles(site.id, page.profiles)).map((p) => ({
    ...p,
    anonymousId: null,
  }));

  return (
    <PeopleClient
      site={{ id: site.id, domain: site.domain }}
      initialProfiles={initialProfiles}
      stats={{
        total: stats.total,
        active7d: stats.active7d,
      }}
    />
  );
}
