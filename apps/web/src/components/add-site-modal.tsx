"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldGroup, TextInput } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/copy-button";
import { DrawCheck, Notice, StepPanel } from "@/components/motion/primitives";

interface AddSiteModalProps {
  workspaceId: string;
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  onSiteAdded?: (site: { id: string; domain: string; displayName: string }) => void;
}

/** Adds a website in two steps inside one dialog: the details, then the tag to paste. The dialog cannot be closed while it saves. */
export function AddSiteModal({ workspaceId, workspaceSlug, isOpen, onClose, onSiteAdded }: AddSiteModalProps) {
  const router = useRouter();
  const [domain, setDomain] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [errorNonce, setErrorNonce] = React.useState(0);
  const [createdSite, setCreatedSite] = React.useState<{ domain: string; snippet: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.trim(), displayName: displayName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.message || "The website could not be added.");
      setCreatedSite({ domain: data.site.domain, snippet: data.snippet });
      onSiteAdded?.(data.site);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The website could not be added.");
      setErrorNonce((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  function handleFinish() {
    onClose();
    if (createdSite) {
      router.push(`/${workspaceSlug}/sites/${createdSite.domain}/realtime`);
      router.refresh();
    }
  }

  return (
    <Dialog
      open={isOpen}
      onClose={createdSite ? handleFinish : onClose}
      dismissible={!loading}
      title={createdSite ? "Website added" : "Add a website"}
      description={createdSite ? `${createdSite.domain} is registered. Paste the tag to start collecting.` : "Track another site, subdomain or web app in this organization."}
      footer={
        createdSite ? (
          <Button onClick={handleFinish}>
            Open analytics <ArrowRight />
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" form="add-site-form" loading={loading} disabled={!domain.trim()}>
              {!loading && <Plus />}
              {loading ? "Adding" : "Add website"}
            </Button>
          </>
        )
      }
    >
      <StepPanel stepKey={createdSite ? "snippet" : "form"}>
        {createdSite ? (
          <div className="flex flex-col items-center gap-5 py-1">
            <DrawCheck size={44} />
            <div className="w-full">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">Tracking snippet</span>
                <CopyButton text={createdSite.snippet} label="Copy" />
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-black/30 p-3 font-mono text-xs leading-5 text-zinc-300">{createdSite.snippet}</pre>
              <p className="mt-2 text-xs text-zinc-500">
                Paste it inside the <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-zinc-300">&lt;head&gt;</code> of your site.
              </p>
            </div>
          </div>
        ) : (
          <form id="add-site-form" onSubmit={handleSubmit}>
            <FieldGroup>
              <Field label="Domain" htmlFor="site-domain" description="Without https:// or a trailing slash">
                <TextInput id="site-domain" required autoFocus placeholder="app.mycompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} className="font-mono" />
              </Field>
              <Field label="Display name (optional)" htmlFor="site-name">
                <TextInput id="site-name" placeholder="Production web app" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
              {error && (
                <Notice nonce={errorNonce} className="rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-sm text-[#e5484d]">
                  {error}
                </Notice>
              )}
            </FieldGroup>
          </form>
        )}
      </StepPanel>
    </Dialog>
  );
}
