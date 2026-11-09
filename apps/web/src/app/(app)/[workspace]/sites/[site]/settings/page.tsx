import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Code2 } from "lucide-react";
import { env } from "@trackme/config";
import { and, asc, db, eq, goals } from "@trackme/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { resolveTrackerScriptUrl, trackerIntegrityAttrs } from "@/lib/tracker-url";
import { SitePrivacyForm } from "@/components/site-privacy-form";
import { CopyButton } from "@/components/ui/copy-button";
import { PrimaryGoalSelect } from "@/components/primary-goal-select";
import { LegalToc } from "@/components/legal-toc";

const SECTIONS = [
  { id: "snippet", title: "Tracking snippet" },
  { id: "release-goal", title: "Release goal" },
  { id: "privacy", title: "Privacy and collection" },
  { id: "retention", title: "Data retention" },
  { id: "public-link", title: "Public dashboard" },
];

export default async function SiteSettingsPage({ params }: { params: Promise<{ workspace: string; site: string }> }) {
  const user = await requireUser();
  const { workspace: workspaceSlug, site: siteDomain } = await params;

  let context: Awaited<ReturnType<typeof requireDashboardSite>>;
  try {
    context = await requireDashboardSite(user.id, workspaceSlug, siteDomain);
  } catch {
    notFound();
  }
  const { workspace, site } = context;

  const siteGoals = await db
    .select({ id: goals.id, name: goals.name })
    .from(goals)
    .where(and(eq(goals.siteId, site.id), eq(goals.enabled, true)))
    .orderBy(asc(goals.createdAt));
  const primaryGoalId = (site.settings as { primaryGoalId?: string | null }).primaryGoalId ?? null;

  const snippet = `<script defer src="${resolveTrackerScriptUrl()}"${trackerIntegrityAttrs()} data-site="${site.publicKey}" data-endpoint="${env.INGESTION_URL}/v1/batch"></script>`;

  return (
    <div className="w-full space-y-6 text-left">
      <PageHeader title="Site Settings" art="gauge">
        Tracking snippet and privacy settings for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[170px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-6">
            <LegalToc items={SECTIONS} />
          </div>
        </aside>

        <div className="min-w-0 max-w-3xl space-y-6">
          <section id="snippet" className="scroll-mt-6">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 border-b border-white/[0.06] pb-4">
                <div>
                  <CardTitle>
                    <Code2 className="size-4 text-zinc-400" aria-hidden="true" />
                    Tracking snippet
                  </CardTitle>
                  <CardDescription>
                    Paste it inside <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-zinc-300">&lt;head&gt;</code> of your site. About 8 KB gzipped, loaded deferred.
                  </CardDescription>
                </div>
                <CopyButton text={snippet} label="Copy snippet" />
              </CardHeader>

              <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-black/30 p-4 font-mono text-xs leading-5 text-zinc-300">{snippet}</pre>

              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span className="flex min-w-0 items-center gap-2">
                  Public write key
                  <code className="truncate rounded bg-white/[0.06] px-2 py-0.5 font-mono text-zinc-200">{site.publicKey}</code>
                  <CopyButton text={site.publicKey} variant="ghost" />
                </span>
                <span className="shrink-0 text-zinc-600">Write only</span>
              </div>
            </Card>
          </section>

          <section id="release-goal" className="scroll-mt-6">
            <PrimaryGoalSelect siteId={site.id} goals={siteGoals} current={primaryGoalId} />
          </section>

          <SitePrivacyForm siteId={site.id} initialSettings={site.settings} />

          <Link
            href={`/${workspace.slug}/settings`}
            className="press flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-zinc-300 hover:border-white/[0.16]"
          >
            <span>
              <span className="text-zinc-100">Looking for API keys, usage or the audit trail?</span>{" "}
              <span className="text-zinc-500">They cover the whole workspace, under Organization and Team.</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
