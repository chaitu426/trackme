import { notFound } from "next/navigation";
import { db, siteUserProfiles, eq, desc, sql } from "@trackme/db";
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

  // Load identified user profiles
  const [profileRows, [stats]] = await Promise.all([
    db
      .select()
      .from(siteUserProfiles)
      .where(eq(siteUserProfiles.siteId, site.id))
      .orderBy(desc(siteUserProfiles.lastSeenAt))
      .limit(50),

    db
      .select({
        total: sql<number>`count(*)::int`,
        active7d: sql<number>`count(*) filter (where ${siteUserProfiles.lastSeenAt} >= now() - interval '7 days')::int`,
      })
      .from(siteUserProfiles)
      .where(eq(siteUserProfiles.siteId, site.id)),
  ]);

  const initialProfiles: UserProfileItem[] = profileRows.map((p) => ({
    id: p.id,
    distinctId: p.distinctId,
    anonymousId: p.anonymousId,
    name: p.name,
    email: p.email,
    traits: (p.traits as Record<string, unknown>) || {},
    totalSessions: p.totalSessions,
    totalEvents: p.totalEvents,
    firstSeenAt: p.firstSeenAt.toISOString(),
    lastSeenAt: p.lastSeenAt.toISOString(),
  }));

  return (
    <PeopleClient
      site={{ id: site.id, domain: site.domain }}
      initialProfiles={initialProfiles}
      stats={{
        total: stats?.total || 0,
        active7d: stats?.active7d || 0,
      }}
    />
  );
}
