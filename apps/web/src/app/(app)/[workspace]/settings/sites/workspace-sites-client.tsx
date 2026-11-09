"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Globe, Plus, Radio, Settings2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { CopyButton } from "@/components/ui/copy-button";
import { AddSiteModal } from "@/components/add-site-modal";
import { toast } from "@/lib/toast";

interface SiteItem {
  id: string;
  domain: string;
  displayName: string;
  publicKey: string;
  createdAt: string;
}

interface WorkspaceSitesClientProps {
  workspace: { id: string; name: string; slug: string; role: string };
  initialSites: SiteItem[];
  trackerScriptUrl: string;
  trackerScriptIntegrity: string | null;
  ingestionUrl: string;
}

export function WorkspaceSitesClient({ workspace, initialSites, trackerScriptUrl, trackerScriptIntegrity, ingestionUrl }: WorkspaceSitesClientProps) {
  const [sitesList, setSitesList] = React.useState<SiteItem[]>(initialSites);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [removing, setRemoving] = React.useState<SiteItem | null>(null);
  const [busy, setBusy] = React.useState(false);

  const snippetFor = (site: SiteItem) =>
    `<script defer src="${trackerScriptUrl}"${trackerScriptIntegrity ? ` integrity="${trackerScriptIntegrity}" crossorigin="anonymous"` : ""} data-site="${site.publicKey}" data-endpoint="${ingestionUrl}/v1/batch"></script>`;

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/sites/${removing.id}`, { method: "DELETE" });
      if (res.ok) {
        setSitesList((prev) => prev.filter((s) => s.id !== removing.id));
        toast.success(`${removing.domain} removed`);
        setRemoving(null);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error("The website could not be removed", data.detail || data.message);
      }
    } catch {
      toast.error("The website could not be removed", "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const onlyOne = sitesList.length <= 1;

  return (
    <div className="stagger w-full space-y-5 text-left">
      <PageHeader
        title="Websites"
        art="stream"
        actions={
          <Button onClick={() => setShowAddModal(true)}>
            <Plus />
            Add website
          </Button>
        }
      >
        Domains and apps tracked under {workspace.name}.
      </PageHeader>

      <Card className="px-0 pb-0">
        <CardHeader className="border-b border-white/[0.06] px-5 pb-3">
          <CardTitle>
            Tracked websites
            <span className="font-mono text-xs text-zinc-500">{sitesList.length}</span>
          </CardTitle>
        </CardHeader>

        <ul className="divide-y divide-white/[0.06]">
          <AnimatePresence initial={false}>
            {sitesList.map((site) => (
              <motion.li
                key={site.id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-white/[0.03] text-zinc-400">
                    <Globe className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-zinc-100">
                      <span className="truncate">{site.displayName || site.domain}</span>
                      <a href={`https://${site.domain}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${site.domain}`} className="press shrink-0 text-zinc-500 hover:text-zinc-200">
                        <ExternalLink className="size-3" />
                      </a>
                    </p>
                    <p className="truncate font-mono text-xs text-zinc-500">{site.domain}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/${workspace.slug}/sites/${site.domain}/realtime`}
                    className="press inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-raised px-3 text-xs font-medium text-zinc-100 hover:border-white/[0.18]"
                  >
                    <Radio className="size-4 text-[#4cc38a]" aria-hidden="true" />
                    Live view
                  </Link>
                  <CopyButton text={snippetFor(site)} label="Copy snippet" variant="outline" />
                  <Link
                    href={`/${workspace.slug}/sites/${site.domain}/settings`}
                    className="press inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-zinc-300 hover:border-white/[0.2] hover:text-zinc-50"
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                    Configure
                  </Link>
                  <Tooltip content={onlyOne ? "An organization needs at least one website" : "Remove website"}>
                    <span>
                      <IconButton size="sm" variant="ghost" label="Remove website" icon={<Trash2 />} disabled={onlyOne} onClick={() => setRemoving(site)} className="hover:text-[#e5484d]" />
                    </span>
                  </Tooltip>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Card>

      <AddSiteModal
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSiteAdded={(newSite) => {
          setSitesList((prev) => [{ id: newSite.id, domain: newSite.domain, displayName: newSite.displayName, publicKey: "", createdAt: new Date().toISOString() }, ...prev]);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        loading={busy}
        title={`Remove ${removing?.domain ?? "website"}?`}
        description="Its collected history is deleted permanently and cannot be recovered. The tracking snippet on the site stops working."
        confirmLabel="Remove website"
      />
    </div>
  );
}
