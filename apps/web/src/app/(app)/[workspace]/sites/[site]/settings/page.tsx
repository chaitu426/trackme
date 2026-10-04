import { notFound } from "next/navigation";
import { Code2 } from "lucide-react";
import { env } from "@trackme/config";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { requireDashboardSite, listApiKeys, getWorkspaceUsage } from "@/lib/tenancy";
import { listWorkspaceAuditLogs } from "@/lib/audit";
import { SitePrivacyForm } from "@/components/site-privacy-form";
import { ApiKeysManager, type ApiKeySummary } from "@/components/api-keys-manager";
import { UsageQuotaCard } from "@/components/usage-quota-card";
import { AuditLogViewer } from "@/components/audit-log-viewer";
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

  const [apiKeyRows, usage, auditLogs] = await Promise.all([
    listApiKeys(workspace.id),
    getWorkspaceUsage(workspace.id),
    listWorkspaceAuditLogs(workspace.id, 15),
  ]);

  const apiKeys: ApiKeySummary[] = apiKeyRows.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    createdAt: key.createdAt.toISOString(),
  }));

  const snippet = `<script defer src="${env.APP_URL}/tracker.js" data-site="${site.publicKey}" data-endpoint="${env.INGESTION_URL}/v1/batch"></script>`;

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ── Page Header ── */}
      <div>
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-zinc-50">Settings</h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          Snippet, privacy, API keys, and audit logs for{" "}
          <span className="font-mono text-zinc-400">{site.domain}</span>
        </p>
      </div>

      {/* ── Usage & Quota ── */}
      <section id="usage" className="space-y-3">
        <UsageQuotaCard usage={usage} />
      </section>

      {/* ── Tracking Snippet ── */}
      <section id="snippet" className="linear-card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <Code2 className="w-4 h-4 text-zinc-200" />
              <h3 className="text-sm font-bold text-zinc-50">Tracking Snippet</h3>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Embed inside <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-zinc-300">&lt;head&gt;</code>{" "}
              of your site. Lightweight (&lt;2 KB) and asynchronously executed.
            </p>
          </div>
          <CopyButton text={snippet} label="Copy Snippet" />
        </div>

        <div className="relative overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4 font-mono text-xs text-zinc-300">
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{snippet}</pre>
        </div>

        <div className="flex flex-col gap-2 pt-1 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center space-x-2">
            <span>Public Write Key:</span>
            <code className="rounded bg-white/[0.06] px-2 py-0.5 font-mono font-semibold text-zinc-200">
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

      {/* ── API Keys ── */}
      <section id="tokens">
        <ApiKeysManager workspaceId={workspace.id} initialKeys={apiKeys} />
      </section>

      {/* ── Audit Trail ── */}
      <section id="audit">
        <AuditLogViewer logs={auditLogs} />
      </section>
    </div>
  );
}
