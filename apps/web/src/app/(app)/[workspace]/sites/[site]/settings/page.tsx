import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { ArrowRight, Code2 } from "lucide-react";
import { env } from "@trackme/config";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite } from "@/lib/tenancy";
import { resolveTrackerScriptUrl, trackerIntegrityAttrs } from "@/lib/tracker-url";
import { SitePrivacyForm } from "@/components/site-privacy-form";
import { CopyButton } from "@/components/ui/copy-button";

export default async function SiteSettingsPage({
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

  const snippet = `<script defer src="${resolveTrackerScriptUrl()}"${trackerIntegrityAttrs()} data-site="${site.publicKey}" data-endpoint="${env.INGESTION_URL}/v1/batch"></script>`;

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader title="Site Settings" art="gauge">
        Tracking snippet and privacy settings for <span className="font-mono text-zinc-300">{site.domain}</span>
      </PageHeader>

      {/* ── Tracking Snippet ── */}
      <section id="snippet" className="linear-card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <Code2 className="w-4 h-4 text-zinc-200" />
              <h3 className="text-sm font-medium text-zinc-50">Tracking Snippet</h3>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Embed inside <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-zinc-300">&lt;head&gt;</code>{" "}
              of your site. Lightweight (&lt;2 KB) and asynchronously executed.
            </p>
          </div>
          <CopyButton text={snippet} label="Copy Snippet" />
        </div>

        <div className="relative overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-xs text-zinc-300">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{snippet}</pre>
        </div>

        <div className="flex flex-col gap-2 pt-1 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center space-x-2">
            <span>Public Write Key:</span>
            <code className="rounded bg-white/[0.06] px-2 py-0.5 font-mono font-medium text-zinc-200">
              {site.publicKey}
            </code>
            <CopyButton text={site.publicKey} variant="ghost" />
          </div>
          <Badge variant="outline">Write-Only</Badge>
        </div>
      </section>

      {/* ── Privacy & Telemetry Form ── */}
      <section id="privacy">
        <SitePrivacyForm siteId={site.id} initialSettings={site.settings} />
      </section>

      <Link
        href={`/${workspace.slug}/settings`}
        className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-card px-4 py-3 text-xs text-zinc-300 transition-colors hover:border-white/[0.16]"
      >
        <span>
          <span className="font-medium text-zinc-100">Looking for API keys, usage or the audit trail?</span>{" "}
          <span className="text-zinc-400">They apply to the whole workspace, so they live under Organization &amp; Team.</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
      </Link>
    </div>
  );
}
