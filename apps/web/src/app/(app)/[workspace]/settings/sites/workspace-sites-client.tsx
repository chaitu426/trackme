"use client";

import * as React from "react";
import Link from "next/link";
import {
  Globe,
  Plus,
  Check,
  Trash2,
  ExternalLink,
  Code2,
  Settings2,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddSiteModal } from "@/components/add-site-modal";

interface SiteItem {
  id: string;
  domain: string;
  displayName: string;
  publicKey: string;
  createdAt: string;
}

interface WorkspaceSitesClientProps {
  workspace: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  initialSites: SiteItem[];
  appUrl: string;
  ingestionUrl: string;
}

export function WorkspaceSitesClient({
  workspace,
  initialSites,
  appUrl,
  ingestionUrl,
}: WorkspaceSitesClientProps) {
  const [sitesList, setSitesList] = React.useState<SiteItem[]>(initialSites);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [copiedDomain, setCopiedDomain] = React.useState<string | null>(null);
  const [busySiteId, setBusySiteId] = React.useState<string | null>(null);

  function getSnippetForSite(site: SiteItem) {
    return `<script defer src="${appUrl}/tracker.js" data-site="${site.publicKey}" data-endpoint="${ingestionUrl}/v1/batch"></script>`;
  }

  function handleCopySnippet(site: SiteItem) {
    const code = getSnippetForSite(site);
    navigator.clipboard.writeText(code);
    setCopiedDomain(site.domain);
    setTimeout(() => setCopiedDomain(null), 2000);
  }

  async function handleDeleteSite(siteId: string, domain: string) {
    if (sitesList.length <= 1) {
      alert("An organization must have at least one website. You cannot delete the only site.");
      return;
    }

    if (
      !confirm(
        `Are you sure you want to remove "${domain}" from this organization? Existing historical telemetry will be permanently purged.`
      )
    ) {
      return;
    }

    setBusySiteId(siteId);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/sites/${siteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSitesList((prev) => prev.filter((s) => s.id !== siteId));
      } else {
        const data = await res.json();
        alert(data.detail || data.message || "Failed to remove website.");
      }
    } catch {
      alert("An error occurred while deleting the site.");
    } finally {
      setBusySiteId(null);
    }
  }

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-zinc-200">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              Websites & Web Properties
            </h1>
            <p className="text-xs text-zinc-400">
              Manage all domains and apps tracked under <span className="font-semibold text-zinc-200">{workspace.name}</span>.
            </p>
          </div>
        </div>

        <Button
          onClick={() => setShowAddModal(true)}
          className="h-10 text-xs font-semibold gap-1.5 shadow-md"
        >
          <Plus className="w-4 h-4" />
          Add Website to Organization
        </Button>
      </div>

      {/* Sites Grid / Table */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            Tracked Domains ({sitesList.length})
          </h3>
        </div>

        <div className="divide-y divide-white/[0.06]">
          {sitesList.map((site) => (
            <div
              key={site.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] text-zinc-300 mt-0.5">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-zinc-100">
                      {site.displayName || site.domain}
                    </span>
                    <a
                      href={`https://${site.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-zinc-300 transition"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="font-mono text-xs text-zinc-400 mt-0.5">{site.domain}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* View Realtime Dashboard */}
                <Link
                  href={`/${workspace.slug}/sites/${site.domain}/realtime`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 font-medium transition"
                >
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                  Live View
                </Link>

                {/* Copy Snippet */}
                <button
                  type="button"
                  onClick={() => handleCopySnippet(site)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition"
                >
                  {copiedDomain === site.domain ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Code2 className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Copy Snippet</span>
                    </>
                  )}
                </button>

                {/* Site Settings */}
                <Link
                  href={`/${workspace.slug}/sites/${site.domain}/settings`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition"
                >
                  <Settings2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Configure</span>
                </Link>

                {/* Delete button (if not only site) */}
                {sitesList.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteSite(site.id, site.domain)}
                    disabled={busySiteId === site.id}
                    className="p-2 text-zinc-500 hover:text-rose-400 transition rounded-lg hover:bg-rose-500/10"
                    title="Remove website from organization"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Site Modal */}
      <AddSiteModal
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSiteAdded={(newSite) => {
          setSitesList((prev) => [
            {
              id: newSite.id,
              domain: newSite.domain,
              displayName: newSite.displayName,
              publicKey: "",
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        }}
      />
    </div>
  );
}
