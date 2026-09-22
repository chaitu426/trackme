/**
 * Ensures the demo site used by test.html /apps/web/public/demo.html exists.
 * Idempotent: upserts by public key.
 */
import { hashApiKey } from "@trackme/authz";
import { db, sites, workspaces, eq } from "@trackme/db";

const DEMO_PUBLIC_KEY = "site_pub_ueBSEXIWEdSjNQdRUu-opxZy";
const DEMO_SETTINGS = {
  collectWebVitals: true,
  respectDoNotTrack: false,
  allowLocalhostTracking: true,
  retentionMonths: 24,
  publicDashboardEnabled: false,
  requireOriginMatch: true,
  requireConsent: false,
  signingRequired: false,
};

async function main() {
  const publicKeyHash = hashApiKey(DEMO_PUBLIC_KEY);

  const existing = await db
    .select({ id: sites.id, workspaceId: sites.workspaceId })
    .from(sites)
    .where(eq(sites.publicKeyHash, publicKeyHash))
    .limit(1);

  if (existing[0]) {
    await db
      .update(sites)
      .set({
        settings: DEMO_SETTINGS,
        domain: "localhost",
        displayName: "TrackMe Demo",
        updatedAt: new Date(),
      })
      .where(eq(sites.id, existing[0].id));

    console.log(`✅ Updated demo site ${existing[0].id} (key=${DEMO_PUBLIC_KEY})`);
    console.log(`   allowLocalhostTracking=true, respectDoNotTrack=false`);
    process.exit(0);
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "TrackMe Demo",
      slug: "trackme-demo",
    })
    .onConflictDoNothing()
    .returning({ id: workspaces.id, slug: workspaces.slug });

  let workspaceId = workspace?.id;
  if (!workspaceId) {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, "trackme-demo"))
      .limit(1);
    workspaceId = rows[0]?.id;
  }

  if (!workspaceId) {
    throw new Error("Failed to create or load demo workspace");
  }

  const [site] = await db
    .insert(sites)
    .values({
      workspaceId,
      domain: "localhost",
      displayName: "TrackMe Demo",
      publicKey: DEMO_PUBLIC_KEY,
      publicKeyHash,
      settings: DEMO_SETTINGS,
    })
    .returning({ id: sites.id });

  console.log(`✅ Created demo site ${site?.id} (key=${DEMO_PUBLIC_KEY})`);
  console.log(`   workspace=${workspaceId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed-demo-site failed:", err);
  process.exit(1);
});
