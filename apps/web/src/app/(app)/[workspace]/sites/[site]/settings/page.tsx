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
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          Site Settings & Security
        </h1>
        <p className="text-xs text-zinc-500 mt-1">
          Manage ingestion telemetry, privacy compliance, API access keys, quotas, and security audit logs for{" "}
          <span className="font-mono font-semibold text-zinc-800">{site.domain}</span>
        </p>
      </div>

      {/* ── Usage & Quota ── */}
      <section id="usage" className="space-y-3">
        <UsageQuotaCard usage={usage} />
      </section>

      {/* ── Tracking Snippet ── */}
      <section id="snippet" className="linear-card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <Code2 className="w-4 h-4 text-zinc-800" />
              <h3 className="text-sm font-bold text-zinc-900">Tracking Snippet</h3>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Embed inside <code className="font-mono text-zinc-700 bg-zinc-100 px-1 py-0.5 rounded">&lt;head&gt;</code>{" "}
              of your site. Lightweight (&lt;2 KB) and asynchronously executed.
            </p>
          </div>
          <CopyButton text={snippet} label="Copy Snippet" />
        </div>

        <div className="relative bg-zinc-900 rounded-xl p-4 font-mono text-xs text-zinc-300 overflow-x-auto border border-zinc-800">
          <pre className="whitespace-pre-wrap text-[11px] font-mono leading-relaxed">{snippet}</pre>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-500 pt-1">
          <div className="flex items-center space-x-2">
            <span>Public Write Key:</span>
            <code className="text-zinc-800 font-mono font-semibold bg-zinc-100 px-2 py-0.5 rounded">
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
